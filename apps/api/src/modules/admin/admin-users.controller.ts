import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Injectable, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { AppError, Errors } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { env } from '../../config/env.js';
import { DB, type Db } from '../../db/db.js';
import { ACTIVE_TRIP_STATUSES, driverProfiles, sessions, trips, users } from '../../db/schema.js';
import { RealtimeEmitter, REDIS } from '../../infra/infra.module.js';
import { AuditService } from '../audit/audit.module.js';
import { AdminOnly, CurrentUser } from '../auth/auth.guard.js';
import { suspendedKey, type AuthUser } from '../auth/tokens.service.js';
import { PresenceService } from '../drivers/presence.service.js';
import { NotificationsService } from '../notifications/notifications.module.js';

const listSchema = z.object({
  /** Nom ou numéro de téléphone (partiel, espaces ignorés pour le numéro). */
  q: z.string().trim().max(80).optional(),
  role: z.enum(['passenger', 'driver', 'admin']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.date().optional(),
});
// Une suspension doit toujours être expliquée : le motif est conservé et visible des autres admins
const suspendSchema = z.object({ reason: z.string().trim().min(3).max(300) });

/** Motif LIKE sûr : les caractères spéciaux saisis par l'admin (% _ \) sont cherchés tels quels. */
const like = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeEmitter,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list(query: z.infer<typeof listSchema>) {
    const phone = query.q?.replace(/[\s-]/g, '');
    const roleFilter = {
      driver: isNotNull(driverProfiles.userId),
      admin: eq(users.isAdmin, true),
      passenger: and(isNull(driverProfiles.userId), eq(users.isAdmin, false)),
    };
    const rows = await this.db
      .select({
        id: users.id,
        phone: users.phone,
        fullName: users.fullName,
        status: users.status,
        isAdmin: users.isAdmin,
        locale: users.locale,
        ratingAvg: users.ratingAvg,
        ratingCount: users.ratingCount,
        createdAt: users.createdAt,
        suspensionReason: users.suspensionReason,
        suspendedAt: users.suspendedAt,
        driverStatus: driverProfiles.status,
      })
      .from(users)
      .leftJoin(driverProfiles, eq(driverProfiles.userId, users.id))
      .where(
        and(
          query.q ? or(ilike(users.phone, like(phone ?? '')), ilike(users.fullName, like(query.q))) : undefined,
          query.role ? roleFilter[query.role] : undefined,
          query.status ? eq(users.status, query.status) : undefined,
          // Postgres stocke des microsecondes, le curseur JS des millisecondes : on compare à la milliseconde.
          query.cursor ? sql`date_trunc('milliseconds', ${users.createdAt}) < ${query.cursor}` : undefined,
        ),
      )
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return { items: page, nextCursor: rows.length > query.limit && last ? last.createdAt.toISOString() : null };
  }

  async get(userId: string) {
    const [row] = await this.db
      .select({ user: users, driverStatus: driverProfiles.status })
      .from(users)
      .leftJoin(driverProfiles, eq(driverProfiles.userId, users.id))
      .where(eq(users.id, userId));
    if (!row) throw Errors.notFound('Utilisateur');

    const counts = await this.db.execute<{ as_passenger: number; as_driver: number; active_trip_id: string | null }>(sql`
      SELECT (SELECT count(*) FROM trips WHERE passenger_id = ${userId})::int AS as_passenger,
             (SELECT count(*) FROM trips WHERE driver_id = ${userId})::int AS as_driver,
             (SELECT id FROM trips WHERE (passenger_id = ${userId} OR driver_id = ${userId})
                AND status IN ('requested', 'driver_assigned', 'driver_arrived', 'in_progress') LIMIT 1) AS active_trip_id`);
    const { as_passenger = 0, as_driver = 0, active_trip_id = null } = counts.rows[0] ?? {};
    return {
      ...row.user,
      driver: row.driverStatus ? { status: row.driverStatus } : null,
      trips: { asPassenger: as_passenger, asDriver: as_driver },
      activeTripId: active_trip_id,
    };
  }

  /**
   * Suspend un compte : connexion refusée, sessions révoquées, jeton d'accès en cours coupé tout de suite, connexions
   * temps réel fermées, chauffeur mis hors ligne. Refusé pendant une course (le passager ou le chauffeur serait lâché
   * en route), pour un autre admin (risque de verrouillage) et pour soi-même.
   */
  async suspend(adminId: string, userId: string, reason: string) {
    if (adminId === userId) throw Errors.conflict('CANNOT_SUSPEND_SELF', 'Vous ne pouvez pas suspendre votre propre compte');

    await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user) throw Errors.notFound('Utilisateur');
      if (user.isAdmin) throw Errors.conflict('CANNOT_SUSPEND_ADMIN', 'Un compte administrateur ne peut pas être suspendu ici');
      if (user.status === 'suspended') throw Errors.conflict('ALREADY_SUSPENDED', 'Compte déjà suspendu');

      const [active] = await tx
        .select({ id: trips.id })
        .from(trips)
        .where(and(or(eq(trips.passengerId, userId), eq(trips.driverId, userId)), inArray(trips.status, [...ACTIVE_TRIP_STATUSES])))
        .limit(1);
      if (active) {
        throw new AppError('USER_HAS_ACTIVE_TRIP', 'Une course est en cours : attendre sa fin ou l’annuler avant de suspendre', HttpStatus.CONFLICT, {
          tripId: active.id,
        });
      }

      await tx.update(users).set({ status: 'suspended', suspensionReason: reason, suspendedAt: new Date() }).where(eq(users.id, userId));
      // La session active est révoquée avec le motif « suspended » : cela ferme sa famille, le refresh token ne renouvelle plus rien
      await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: 'suspended' }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await this.audit.record(adminId, { action: 'user.suspend', entity: 'user', entityId: userId, details: { reason } }, tx);
    });

    // Effets immédiats, après validation de la transaction
    await this.redis.set(suspendedKey(userId), '1', 'EX', env().JWT_ACCESS_TTL_S + 60);
    await this.presence.goOffline(userId);
    this.realtime.disconnectUser(userId);
    void this.notifications.notify(userId, 'account.suspended');
    return this.get(userId);
  }

  async reactivate(adminId: string, userId: string) {
    await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
      if (!user) throw Errors.notFound('Utilisateur');
      if (user.status !== 'suspended') throw Errors.conflict('NOT_SUSPENDED', 'Ce compte n’est pas suspendu');
      await tx.update(users).set({ status: 'active', suspensionReason: null, suspendedAt: null }).where(eq(users.id, userId));
      await this.audit.record(
        adminId,
        { action: 'user.reactivate', entity: 'user', entityId: userId, details: { previousReason: user.suspensionReason } },
        tx,
      );
    });
    await this.redis.del(suspendedKey(userId));
    void this.notifications.notify(userId, 'account.reactivated');
    return this.get(userId);
  }
}

@AdminOnly()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiQuery({ name: 'q', required: false, description: 'Nom ou numéro de téléphone (partiel)' })
  @ApiQuery({ name: 'role', required: false, enum: ['passenger', 'driver', 'admin'] })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'suspended'] })
  @ApiQuery({ name: 'limit', required: false, description: '1 à 50 (défaut 20)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor de la page précédente' })
  list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.users.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(suspendSchema)) body: z.infer<typeof suspendSchema>,
  ) {
    return this.users.suspend(admin.id, id, body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivate(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.reactivate(admin.id, id);
  }
}
