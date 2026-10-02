import { Controller, Get, HttpStatus, Inject, Query, StreamableFile } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { type Cell, money, toCsv } from '../../common/csv.js';
import { AppError } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import { payments, pricingRules, trips, users } from '../../db/schema.js';
import { AuditService } from '../audit/audit.module.js';
import { AdminOnly, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { commissionOf, debtOf } from '../wallet/commission.js';

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
/** Garde-fou : un fichier plus gros se découpe par période (il est construit en mémoire). */
const MAX_ROWS = 50_000;

/** Jours calendaires à Tunis, bornes incluses (UTC+1 toute l'année, plus d'heure d'été depuis 2008). */
const rangeSchema = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((r) => r.to >= r.from && (Date.parse(r.to) - Date.parse(r.from)) / DAY_MS < MAX_DAYS, {
    message: 'INVALID_RANGE',
    path: ['to'],
  });
type Range = z.infer<typeof rangeSchema>;

const bounds = ({ from, to }: Range) => ({
  start: new Date(`${from}T00:00:00+01:00`),
  end: new Date(new Date(`${to}T00:00:00+01:00`).getTime() + DAY_MS), // exclu : le lendemain à minuit
});

const TRIP_STATUS: Record<string, string> = {
  requested: 'Recherche de chauffeur',
  driver_assigned: 'Chauffeur en route',
  driver_arrived: 'Chauffeur arrivé',
  in_progress: 'En course',
  completed: 'Terminée',
  cancelled_by_passenger: 'Annulée par le passager',
  cancelled_by_driver: 'Annulée par le chauffeur',
  no_driver_found: 'Aucun chauffeur trouvé',
};
const PAYMENT_STATUS: Record<string, string> = { pending: 'À encaisser', succeeded: 'Encaissé', failed: 'Échoué', refunded: 'Remboursé' };
const PAYMENT_METHOD: Record<string, string> = { cash: 'Espèces' };

const csv = (name: string, content: string) =>
  new StreamableFile(Buffer.from(content, 'utf8'), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${name}"` });

/**
 * Exports comptables en CSV (Excel). Les données personnelles sont réduites au nécessaire (pas de numéro de téléphone des
 * passagers) et chaque export est inscrit au journal d'audit, avec la période et le nombre de lignes.
 */
@AdminOnly()
@Controller('admin/exports')
export class AdminExportsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get('trips.csv')
  @ApiQuery({ name: 'from', required: true, description: 'Premier jour inclus, AAAA-MM-JJ (heure de Tunis)' })
  @ApiQuery({ name: 'to', required: true, description: 'Dernier jour inclus, AAAA-MM-JJ (366 jours maximum)' })
  async trips(@CurrentUser() admin: AuthUser, @Query(new ZodPipe(rangeSchema)) range: Range) {
    const { start, end } = bounds(range);
    const driver = alias(users, 'driver');
    const rows = await this.db
      .select({
        trip: trips,
        driverName: driver.fullName,
        paymentMethod: payments.method,
        paymentStatus: payments.status,
        ruleBps: pricingRules.commissionBps,
      })
      .from(trips)
      .leftJoin(driver, eq(driver.id, trips.driverId))
      .leftJoin(payments, eq(payments.tripId, trips.id))
      .leftJoin(pricingRules, eq(pricingRules.id, trips.pricingRuleId))
      .where(and(gte(trips.requestedAt, start), lt(trips.requestedAt, end)))
      .orderBy(asc(trips.requestedAt))
      .limit(MAX_ROWS + 1);
    if (rows.length > MAX_ROWS) throw tooLarge();

    const headers = [
      'Identifiant course',
      'Demandée le',
      'Terminée le',
      'Statut',
      'Catégorie',
      'Chauffeur',
      'Identifiant chauffeur',
      'Identifiant passager',
      'Départ',
      'Arrivée',
      'Distance estimée (km)',
      'Prix annoncé (DT)',
      'Prix final (DT)',
      'Taux de commission (%)',
      'Commission (DT)',
      'Mode de paiement',
      'Statut du paiement',
      'Frais d’annulation (DT)',
    ];
    const lines: Cell[][] = rows.map(({ trip, driverName, paymentMethod, paymentStatus, ruleBps }) => {
      const bps = trip.commissionBps ?? ruleBps ?? 0;
      const collected = trip.status === 'completed' && paymentStatus === 'succeeded' && trip.finalPrice !== null;
      return [
        trip.id,
        trip.requestedAt,
        trip.completedAt,
        TRIP_STATUS[trip.status] ?? trip.status,
        trip.category,
        driverName,
        trip.driverId,
        trip.passengerId,
        trip.pickupAddress,
        trip.dropoffAddress,
        Math.round(trip.estimatedDistanceM / 100) / 10,
        money(trip.quotedPrice),
        money(trip.finalPrice),
        bps / 100,
        collected ? money(commissionOf(trip.finalPrice!, bps)) : null,
        paymentMethod ? (PAYMENT_METHOD[paymentMethod] ?? paymentMethod) : null,
        paymentStatus ? (PAYMENT_STATUS[paymentStatus] ?? paymentStatus) : null,
        money(trip.cancellationFee),
      ];
    });

    await this.recordExport(admin.id, 'export.trips', range, lines.length);
    return csv(`courses_${range.from}_${range.to}.csv`, toCsv(headers, lines));
  }

  @Get('driver-earnings.csv')
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  async driverEarnings(@CurrentUser() admin: AuthUser, @Query(new ZodPipe(rangeSchema)) range: Range) {
    const { start, end } = bounds(range);
    type Row = { id: string; full_name: string | null; phone: string; trips: number; gross: number; commission: number; settlements: number; balance: number };
    const result = await this.db.execute<Row>(sql`
      WITH trip_stats AS (
        SELECT t.driver_id, count(*)::int AS trips, COALESCE(SUM(t.final_price), 0)::float8 AS gross
        FROM trips t JOIN payments p ON p.trip_id = t.id
        WHERE t.status = 'completed' AND p.status = 'succeeded' AND t.completed_at >= ${start} AND t.completed_at < ${end}
        GROUP BY t.driver_id
      ), wallet_stats AS (
        SELECT w.user_id AS driver_id,
               COALESCE(SUM(-wt.amount) FILTER (WHERE wt.type = 'platform_commission'), 0)::float8 AS commission,
               COALESCE(SUM(wt.amount) FILTER (WHERE wt.type = 'settlement'), 0)::float8 AS settlements
        FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id
        WHERE wt.created_at >= ${start} AND wt.created_at < ${end}
        GROUP BY w.user_id
      )
      SELECT u.id, u.full_name, u.phone, COALESCE(ts.trips, 0) AS trips, COALESCE(ts.gross, 0) AS gross,
             COALESCE(ws.commission, 0) AS commission, COALESCE(ws.settlements, 0) AS settlements, COALESCE(w.balance, 0) AS balance
      FROM users u
      LEFT JOIN trip_stats ts ON ts.driver_id = u.id
      LEFT JOIN wallet_stats ws ON ws.driver_id = u.id
      LEFT JOIN wallets w ON w.user_id = u.id
      WHERE ts.driver_id IS NOT NULL OR ws.driver_id IS NOT NULL
      ORDER BY COALESCE(ts.gross, 0) DESC, u.id
      LIMIT ${MAX_ROWS + 1}`);
    if (result.rows.length > MAX_ROWS) throw tooLarge();

    const headers = [
      'Identifiant chauffeur',
      'Nom',
      'Téléphone',
      'Courses encaissées',
      'Encaissé (DT)',
      'Commission due (DT)',
      'Net chauffeur (DT)',
      'Règlements reçus (DT)',
      'Dette actuelle (DT)',
    ];
    const lines: Cell[][] = result.rows.map((r) => [
      r.id,
      r.full_name,
      r.phone,
      r.trips,
      money(Math.round(r.gross)),
      money(Math.round(r.commission)),
      money(Math.round(r.gross - r.commission)),
      money(Math.round(r.settlements)),
      money(debtOf(r.balance)),
    ]);

    await this.recordExport(admin.id, 'export.driver_earnings', range, lines.length);
    return csv(`gains-chauffeurs_${range.from}_${range.to}.csv`, toCsv(headers, lines));
  }

  /** Une sortie de données personnelles se trace avant d'être livrée : si le journal échoue, l'export aussi. */
  private recordExport(adminId: string, action: string, range: Range, rows: number) {
    return this.audit.record(adminId, { action, entity: 'export', entityId: `${range.from}..${range.to}`, details: { ...range, rows } });
  }
}

const tooLarge = () =>
  new AppError('EXPORT_TOO_LARGE', `Plus de ${MAX_ROWS} lignes : réduire la période`, HttpStatus.PAYLOAD_TOO_LARGE);
