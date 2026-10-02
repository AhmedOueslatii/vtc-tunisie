import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import { ACTIVE_TRIP_STATUSES, driverProfiles, supportTickets, trips } from '../../db/schema.js';
import { AdminOnly } from '../auth/auth.guard.js';
import { PresenceService } from '../drivers/presence.service.js';

const querySchema = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), '7, 30 ou 90').default(7) });
const DAY_MS = 86_400_000;
const TZ = 'Africa/Tunis';

/** Date calendaire (AAAA-MM-JJ) à Tunis, `daysAgo` jours avant aujourd'hui. */
const tunisDay = (daysAgo: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() - daysAgo * DAY_MS));

type DailyRow = { day: string; requested: number; completed: number; revenue: number };

/** Tableau de bord : activité en direct + indicateurs de la période. Montants en millimes. */
@AdminOnly()
@Controller('admin/stats')
export class AdminStatsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly presence: PresenceService,
  ) {}

  @Get('overview')
  @ApiQuery({ name: 'days', required: false, enum: [7, 30, 90], description: 'Période (défaut 7 jours)' })
  async overview(@Query(new ZodPipe(querySchema)) { days }: z.infer<typeof querySchema>) {
    // Fenêtre alignée sur les jours calendaires (aujourd'hui inclus) pour que totaux et courbe quotidienne concordent.
    // La Tunisie est à UTC+1 toute l'année (plus d'heure d'été depuis 2008).
    const since = new Date(`${tunisDay(days - 1)}T00:00:00+01:00`);

    const [statusRows, money, dailyRows, live, debt, newUsers] = await Promise.all([
      this.db
        .select({ status: trips.status, count: sql<number>`count(*)::int` })
        .from(trips)
        .where(sql`${trips.requestedAt} >= ${since}`)
        .groupBy(trips.status),
      // Chiffre d'affaires brut et commission estimée (taux de la règle appliquée à chaque course terminée)
      this.db.execute<{ gross: number; commission: number }>(sql`
        SELECT COALESCE(SUM(t.final_price), 0)::float8 AS gross,
               COALESCE(SUM(t.final_price * COALESCE(t.commission_bps, r.commission_bps) / 10000.0), 0)::float8 AS commission
        FROM trips t JOIN pricing_rules r ON r.id = t.pricing_rule_id
        WHERE t.status = 'completed' AND t.requested_at >= ${since}`),
      this.db.execute<DailyRow>(sql`
        SELECT to_char((requested_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS day,
               count(*)::int AS requested,
               (count(*) FILTER (WHERE status = 'completed'))::int AS completed,
               COALESCE(SUM(final_price) FILTER (WHERE status = 'completed'), 0)::float8 AS revenue
        FROM trips WHERE requested_at >= ${since}
        GROUP BY 1 ORDER BY 1`),
      Promise.all([
        this.db.select({ count: sql<number>`count(*)::int` }).from(trips).where(inArray(trips.status, [...ACTIVE_TRIP_STATUSES])),
        this.presence.countAvailable(),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(driverProfiles)
          .where(inArray(driverProfiles.status, ['pending_documents', 'under_review'])),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(supportTickets)
          .where(inArray(supportTickets.status, ['open', 'in_progress'])),
      ]),
      this.db.execute<{ total: number; drivers: number }>(sql`
        SELECT COALESCE(SUM(-balance), 0)::float8 AS total, count(*)::int AS drivers FROM wallets WHERE balance < 0`),
      this.db.execute<{ passengers: number; drivers: number }>(sql`
        SELECT (SELECT count(*) FROM users WHERE created_at >= ${since})::int AS passengers,
               (SELECT count(*) FROM driver_profiles WHERE approved_at >= ${since})::int AS drivers`),
    ]);

    const byStatus = new Map(statusRows.map((r) => [r.status, r.count]));
    const completed = byStatus.get('completed') ?? 0;
    const requested = statusRows.reduce((sum, r) => sum + r.count, 0);
    const { gross = 0, commission = 0 } = money.rows[0] ?? {};
    const [active, available, pendingDrivers, openTickets] = live;

    // Un jour sans course apparaît quand même (à zéro) : le graphique ne saute pas de dates
    const byDay = new Map(dailyRows.rows.map((r) => [r.day, r]));
    const daily: DailyRow[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = tunisDay(i);
      daily.push(byDay.get(day) ?? { day, requested: 0, completed: 0, revenue: 0 });
    }

    return {
      range: { days, since },
      live: {
        activeTrips: active[0]?.count ?? 0,
        availableDrivers: available,
        pendingDrivers: pendingDrivers[0]?.count ?? 0,
        openTickets: openTickets[0]?.count ?? 0,
        // Commissions cash dues par les chauffeurs à la plateforme
        totalDebt: Math.round(debt.rows[0]?.total ?? 0),
        driversInDebt: debt.rows[0]?.drivers ?? 0,
      },
      totals: {
        requested,
        completed,
        cancelledByPassenger: byStatus.get('cancelled_by_passenger') ?? 0,
        cancelledByDriver: byStatus.get('cancelled_by_driver') ?? 0,
        noDriverFound: byStatus.get('no_driver_found') ?? 0,
        completionRate: requested > 0 ? completed / requested : null,
        grossRevenue: Math.round(gross),
        estimatedCommission: Math.round(commission),
        averagePrice: completed > 0 ? Math.round(gross / completed) : null,
      },
      newUsers: { passengers: newUsers.rows[0]?.passengers ?? 0, drivers: newUsers.rows[0]?.drivers ?? 0 },
      daily,
    };
  }
}
