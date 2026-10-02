import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { Errors } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import {
  ACTIVE_TRIP_STATUSES,
  payments,
  ratings,
  supportTickets,
  tripEvents,
  tripOffers,
  tripStatusEnum,
  trips,
  users,
  vehicles,
} from '../../db/schema.js';
import { AdminOnly } from '../auth/auth.guard.js';

const listSchema = z.object({
  /** Un statut précis, ou `active` pour les courses en cours (demandée, chauffeur en route, à bord…). */
  status: z.enum([...tripStatusEnum.enumValues, 'active']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.date().optional(),
});

// Générique : un alias de table (`passenger`, `driver`…) n'a pas le même type que `users`
const person = <I, N, P>(t: { id: I; fullName: N; phone: P }) => ({ id: t.id, fullName: t.fullName, phone: t.phone });

/** Supervision des courses pour le back-office. La trace GPS est sur `GET /admin/trips/:id/track`. */
@AdminOnly()
@Controller('admin/trips')
export class AdminTripsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: [...tripStatusEnum.enumValues, 'active'] })
  @ApiQuery({ name: 'limit', required: false, description: '1 à 50 (défaut 20)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor de la page précédente' })
  async list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    const passenger = alias(users, 'passenger');
    const driver = alias(users, 'driver');
    const statusFilter =
      query.status === 'active'
        ? inArray(trips.status, [...ACTIVE_TRIP_STATUSES])
        : query.status
          ? eq(trips.status, query.status)
          : undefined;

    const rows = await this.db
      .select({
        trip: {
          id: trips.id,
          status: trips.status,
          category: trips.category,
          pickupAddress: trips.pickupAddress,
          dropoffAddress: trips.dropoffAddress,
          quotedPrice: trips.quotedPrice,
          finalPrice: trips.finalPrice,
          requestedAt: trips.requestedAt,
          completedAt: trips.completedAt,
        },
        passenger: person(passenger),
        driver: person(driver),
      })
      .from(trips)
      .innerJoin(passenger, eq(passenger.id, trips.passengerId))
      .leftJoin(driver, eq(driver.id, trips.driverId))
      .where(
        and(
          statusFilter,
          // Postgres stocke des microsecondes, le curseur JS des millisecondes : on compare à la milliseconde.
          query.cursor ? sql`date_trunc('milliseconds', ${trips.requestedAt}) < ${query.cursor}` : undefined,
        ),
      )
      .orderBy(desc(trips.requestedAt))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1)?.trip;
    return {
      items: page.map(({ trip, passenger: p, driver: d }) => ({ ...trip, passenger: p, driver: d?.id ? d : null })),
      nextCursor: rows.length > query.limit && last ? last.requestedAt.toISOString() : null,
    };
  }

  /** Dossier complet d'une course : parties, véhicule, paiement, historique des statuts, offres, notes, signalements. */
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const passenger = alias(users, 'passenger');
    const driver = alias(users, 'driver');
    const offered = alias(users, 'offered');

    const [row] = await this.db
      .select({ trip: trips, passenger: person(passenger), driver: person(driver) })
      .from(trips)
      .innerJoin(passenger, eq(passenger.id, trips.passengerId))
      .leftJoin(driver, eq(driver.id, trips.driverId))
      .where(eq(trips.id, id));
    if (!row) throw Errors.notFound('Course');
    const { idempotencyKey: _k, offeredDriverId: _o, pricingRuleId: _p, ...trip } = row.trip;

    const [vehicle, payment, events, offers, ratingRows, tickets] = await Promise.all([
      row.trip.vehicleId
        ? this.db
            .select({ make: vehicles.make, model: vehicles.model, color: vehicles.color, plate: vehicles.plate })
            .from(vehicles)
            .where(eq(vehicles.id, row.trip.vehicleId))
            .then((r) => r[0] ?? null)
        : null,
      this.db
        .select({ method: payments.method, amount: payments.amount, status: payments.status })
        .from(payments)
        .where(eq(payments.tripId, id))
        .then((r) => r[0] ?? null),
      this.db
        .select({ id: tripEvents.id, fromStatus: tripEvents.fromStatus, toStatus: tripEvents.toStatus, actorId: tripEvents.actorId, meta: tripEvents.meta, at: tripEvents.at })
        .from(tripEvents)
        .where(eq(tripEvents.tripId, id))
        .orderBy(asc(tripEvents.at), asc(tripEvents.id)),
      this.db
        .select({
          id: tripOffers.id,
          status: tripOffers.status,
          distanceM: tripOffers.distanceM,
          offeredAt: tripOffers.offeredAt,
          respondedAt: tripOffers.respondedAt,
          driver: person(offered),
        })
        .from(tripOffers)
        .innerJoin(offered, eq(offered.id, tripOffers.driverId))
        .where(eq(tripOffers.tripId, id))
        .orderBy(asc(tripOffers.offeredAt)),
      this.db
        .select({ raterId: ratings.raterId, rateeId: ratings.rateeId, score: ratings.score, comment: ratings.comment })
        .from(ratings)
        .where(eq(ratings.tripId, id)),
      this.db
        .select({ id: supportTickets.id, category: supportTickets.category, status: supportTickets.status, createdAt: supportTickets.createdAt })
        .from(supportTickets)
        .where(eq(supportTickets.tripId, id)),
    ]);

    return {
      ...trip,
      passenger: row.passenger,
      driver: row.driver?.id ? row.driver : null,
      vehicle,
      payment,
      events,
      offers,
      ratings: ratingRows,
      tickets,
    };
  }
}
