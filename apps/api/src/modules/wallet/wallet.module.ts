import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError, Errors } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { env } from '../../config/env.js';
import { DB, type Db } from '../../db/db.js';
import { driverProfiles, pricingRules, users, walletTransactions, wallets } from '../../db/schema.js';
import { AuditService } from '../audit/audit.module.js';
import { AdminOnly, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { PresenceService } from '../drivers/presence.service.js';
import { NotificationsService } from '../notifications/notifications.module.js';
import { commissionOf, debtOf, debtState } from './commission.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type TxType = typeof walletTransactions.$inferInsert.type;
interface Entry {
  type: TxType;
  /** Signé : négatif = le chauffeur doit davantage (commission), positif = il doit moins (règlement). */
  amount: number;
  tripId?: string;
  note?: string;
}
export interface BalanceChange {
  before: number;
  after: number;
}

const MAX_AMOUNT = 1_000_000; // 1000 DT : garde-fou contre une faute de frappe

const settlementSchema = z.object({
  amount: z.number().int().min(1).max(MAX_AMOUNT),
  note: z.string().trim().max(300).optional(),
});
const adjustmentSchema = z.object({
  amount: z
    .number()
    .int()
    .min(-MAX_AMOUNT)
    .max(MAX_AMOUNT)
    .refine((n) => n !== 0, 'Montant nul'),
  // Une correction manuelle de l'argent d'un chauffeur doit toujours être expliquée
  reason: z.string().trim().min(3).max(300),
});
const historySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.coerce.date().optional(),
});
const debtsSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const earningsSchema = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), '7, 30 ou 90').default(30) });

@Injectable()
export class WalletService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ─── Écriture du grand livre ───────────────────────────────────────────────

  /** Crée le portefeuille au besoin et le verrouille : deux écritures simultanées se suivent, aucune n'est perdue. */
  private async lock(tx: Tx, driverId: string) {
    await tx.insert(wallets).values({ userId: driverId }).onConflictDoNothing();
    const [wallet] = await tx.select().from(wallets).where(eq(wallets.userId, driverId)).for('update');
    return wallet!;
  }

  /** Ajoute une ligne au grand livre (jamais modifiée ensuite) et met à jour le solde. `null` si la ligne existait déjà. */
  private async append(tx: Tx, wallet: { id: string; balance: number }, entry: Entry): Promise<BalanceChange | null> {
    const after = wallet.balance + entry.amount;
    const inserted = await tx
      .insert(walletTransactions)
      .values({ walletId: wallet.id, ...entry, balanceAfter: after })
      .onConflictDoNothing() // une seule commission par course (index unique)
      .returning({ id: walletTransactions.id });
    if (inserted.length === 0) return null;
    await tx.update(wallets).set({ balance: after }).where(eq(wallets.id, wallet.id));
    return { before: wallet.balance, after };
  }

  /**
   * Commission de la plateforme sur une course payée en espèces : le chauffeur a encaissé le prix, il doit la commission.
   * Taux figé à la commande ; à défaut (course antérieure), celui de la règle tarifaire appliquée.
   */
  async recordCommission(
    tx: Tx,
    trip: { id: string; driverId: string; finalPrice: number | null; quotedPrice: number; commissionBps: number | null; pricingRuleId: string },
  ): Promise<BalanceChange | null> {
    const bps =
      trip.commissionBps ??
      (await tx.select({ bps: pricingRules.commissionBps }).from(pricingRules).where(eq(pricingRules.id, trip.pricingRuleId)))[0]?.bps ??
      0;
    const amount = commissionOf(trip.finalPrice ?? trip.quotedPrice, bps);
    if (amount <= 0) return null;
    const wallet = await this.lock(tx, trip.driverId);
    return this.append(tx, wallet, { type: 'platform_commission', amount: -amount, tripId: trip.id });
  }

  /**
   * Après un changement de solde : prévient le chauffeur quand il franchit le seuil d'alerte, et le met hors ligne
   * (sauf s'il est en course) quand il atteint le plafond. À appeler APRÈS la validation de la transaction.
   */
  async afterChange(driverId: string, change: BalanceChange): Promise<void> {
    const ceiling = env().DRIVER_DEBT_CEILING;
    const before = debtState(debtOf(change.before), ceiling);
    const after = debtState(debtOf(change.after), ceiling);
    if (before === after || after === 'ok') return;

    const params = { debt: debtOf(change.after), ceiling };
    if (after === 'warning' && before === 'ok') {
      void this.notifications.notify(driverId, 'wallet.debt_warning', params);
    } else if (after === 'blocked') {
      const state = await this.presence.getState(driverId);
      if (state?.status === 'online') await this.presence.goOffline(driverId);
      void this.notifications.notify(driverId, 'wallet.debt_limit', params);
    }
  }

  // ─── Actions de l'admin ────────────────────────────────────────────────────

  private async requireDriver(driverId: string) {
    const [profile] = await this.db.select({ id: driverProfiles.userId }).from(driverProfiles).where(eq(driverProfiles.userId, driverId));
    if (!profile) throw Errors.notFound('Chauffeur');
  }

  /** Le chauffeur a remis de l'argent à la plateforme : sa dette baisse. Un règlement ne peut pas dépasser la dette. */
  async settle(adminId: string, driverId: string, input: z.infer<typeof settlementSchema>) {
    await this.requireDriver(driverId);
    const change = await this.db.transaction(async (tx) => {
      const wallet = await this.lock(tx, driverId);
      const debt = debtOf(wallet.balance);
      if (input.amount > debt) {
        throw new AppError('SETTLEMENT_EXCEEDS_DEBT', 'Le règlement dépasse la dette du chauffeur', HttpStatus.CONFLICT, {
          debt,
          amount: input.amount,
        });
      }
      const result = (await this.append(tx, wallet, { type: 'settlement', amount: input.amount, note: input.note }))!;
      await this.audit.record(
        adminId,
        { action: 'wallet.settlement', entity: 'wallet', entityId: driverId, details: { amount: input.amount, note: input.note, balanceAfter: result.after } },
        tx,
      );
      return result;
    });
    void this.notifications.notify(driverId, 'wallet.settlement', { amount: input.amount, debt: debtOf(change.after) });
    return this.summary(driverId);
  }

  /** Correction manuelle (pénalité, erreur de saisie) : signée, motivée, journalisée. */
  async adjust(adminId: string, driverId: string, input: z.infer<typeof adjustmentSchema>) {
    await this.requireDriver(driverId);
    const change = await this.db.transaction(async (tx) => {
      const wallet = await this.lock(tx, driverId);
      const result = (await this.append(tx, wallet, { type: 'adjustment', amount: input.amount, note: input.reason }))!;
      await this.audit.record(
        adminId,
        { action: 'wallet.adjustment', entity: 'wallet', entityId: driverId, details: { amount: input.amount, reason: input.reason, balanceAfter: result.after } },
        tx,
      );
      return result;
    });
    await this.afterChange(driverId, change);
    return this.summary(driverId);
  }

  // ─── Lecture ───────────────────────────────────────────────────────────────

  async summary(driverId: string) {
    const [wallet] = await this.db.select({ balance: wallets.balance }).from(wallets).where(eq(wallets.userId, driverId));
    const balance = wallet?.balance ?? 0;
    const debt = debtOf(balance);
    const ceiling = env().DRIVER_DEBT_CEILING;
    return { balance, debt, ceiling, state: debtState(debt, ceiling) };
  }

  async history(driverId: string, limit: number, cursor?: Date) {
    const rows = await this.db
      .select({ tx: walletTransactions })
      .from(walletTransactions)
      .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
      .where(
        and(
          eq(wallets.userId, driverId),
          // Postgres stocke des microsecondes, le curseur JS des millisecondes : on compare à la milliseconde.
          cursor ? sql`date_trunc('milliseconds', ${walletTransactions.createdAt}) < ${cursor}` : undefined,
        ),
      )
      .orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit).map((r) => r.tx);
    const last = page.at(-1);
    return { items: page, nextCursor: rows.length > limit && last ? last.createdAt.toISOString() : null };
  }

  /** Courses encaissées, commissions et net sur la période. */
  async earnings(driverId: string, days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const [trips, commissions] = await Promise.all([
      this.db.execute<{ trips: number; gross: number }>(sql`
        SELECT count(*)::int AS trips, COALESCE(SUM(t.final_price), 0)::float8 AS gross
        FROM trips t JOIN payments p ON p.trip_id = t.id
        WHERE t.driver_id = ${driverId} AND t.status = 'completed' AND p.status = 'succeeded' AND t.completed_at >= ${since}`),
      this.db.execute<{ commission: number }>(sql`
        SELECT COALESCE(SUM(-wt.amount), 0)::float8 AS commission
        FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id
        WHERE w.user_id = ${driverId} AND wt.type = 'platform_commission' AND wt.created_at >= ${since}`),
    ]);
    const gross = Math.round(trips.rows[0]?.gross ?? 0);
    const commission = Math.round(commissions.rows[0]?.commission ?? 0);
    return { days, trips: trips.rows[0]?.trips ?? 0, gross, commission, net: gross - commission };
  }

  /** Chauffeurs endettés, du plus endetté au moins endetté, avec leur état par rapport au plafond. */
  async debts(limit: number) {
    const ceiling = env().DRIVER_DEBT_CEILING;
    const rows = await this.db
      .select({ driverId: users.id, fullName: users.fullName, phone: users.phone, balance: wallets.balance, updatedAt: wallets.updatedAt })
      .from(wallets)
      .innerJoin(users, eq(users.id, wallets.userId))
      .where(lt(wallets.balance, 0))
      .orderBy(wallets.balance)
      .limit(limit);
    return rows.map((r) => ({ ...r, debt: debtOf(r.balance), state: debtState(debtOf(r.balance), ceiling) }));
  }
}

/** Le chauffeur consulte son propre portefeuille. */
@Controller('drivers/me/wallet')
export class DriverWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @ApiQuery({ name: 'limit', required: false, description: '1 à 100 (défaut 30)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor de la page précédente' })
  @ApiQuery({ name: 'days', required: false, description: 'Période des gains : 7, 30 ou 90 (défaut 30)' })
  async get(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(historySchema.extend(earningsSchema.shape))) query: z.infer<typeof historySchema> & z.infer<typeof earningsSchema>,
  ) {
    const [summary, earnings, transactions] = await Promise.all([
      this.wallet.summary(user.id),
      this.wallet.earnings(user.id, query.days),
      this.wallet.history(user.id, query.limit, query.cursor),
    ]);
    return { ...summary, earnings, transactions };
  }
}

@AdminOnly()
@Controller('admin')
export class AdminWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('wallets/debts')
  @ApiQuery({ name: 'limit', required: false, description: '1 à 100 (défaut 50)' })
  async debts(@Query(new ZodPipe(debtsSchema)) query: z.infer<typeof debtsSchema>) {
    return { ceiling: env().DRIVER_DEBT_CEILING, items: await this.wallet.debts(query.limit) };
  }

  @Get('drivers/:id/wallet')
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  async get(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(historySchema)) query: z.infer<typeof historySchema>) {
    const [summary, transactions] = await Promise.all([this.wallet.summary(id), this.wallet.history(id, query.limit, query.cursor)]);
    return { ...summary, transactions };
  }

  @Post('drivers/:id/wallet/settlements')
  @HttpCode(HttpStatus.OK)
  settle(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(settlementSchema)) body: z.infer<typeof settlementSchema>,
  ) {
    return this.wallet.settle(admin.id, id, body);
  }

  @Post('drivers/:id/wallet/adjustments')
  @HttpCode(HttpStatus.OK)
  adjust(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(adjustmentSchema)) body: z.infer<typeof adjustmentSchema>,
  ) {
    return this.wallet.adjust(admin.id, id, body);
  }
}

@Module({
  imports: [DriversModule],
  controllers: [DriverWalletController, AdminWalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
