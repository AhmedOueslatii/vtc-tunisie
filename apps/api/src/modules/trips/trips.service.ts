import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { uniqueViolation } from '../../common/db-errors.js';
import { AppError, Errors } from '../../common/errors.js';
import { haversineMeters, isInTunisia, type LatLng } from '../../common/geo.js';
import { env } from '../../config/env.js';
import { DB, type Db } from '../../db/db.js';
import {
  ACTIVE_TRIP_STATUSES,
  locationPoints,
  payments,
  ratings,
  tripEvents,
  tripOffers,
  trips,
  users,
  vehicles,
} from '../../db/schema.js';
import { RealtimeEmitter, REDIS } from '../../infra/infra.module.js';
import { PresenceService, type VehicleCategory } from '../drivers/presence.service.js';
import { MatchingService } from '../matching/matching.service.js';
import { NotificationsService } from '../notifications/notifications.module.js';
import { PricingService } from '../pricing/pricing.service.js';
import { WalletService, type BalanceChange } from '../wallet/wallet.module.js';
import { ROUTING_PROVIDER, type RoutingProvider } from '../routing/routing.provider.js';

type Trip = typeof trips.$inferSelect;
type TripStatus = Trip['status'];

export interface EstimateInput {
  pickup: LatLng;
  dropoff: LatLng;
  pickupAddress?: string;
  dropoffAddress?: string;
  category: VehicleCategory;
}

interface Quote extends EstimateInput {
  passengerId: string;
  distanceM: number;
  durationS: number;
  price: number;
  surge: number;
  pricingRuleId: string;
  /** Absent des devis émis avant l'introduction du taux figé : on retombe alors sur la règle tarifaire. */
  commissionBps?: number;
}

const MIN_TRIP_M = 300;
const MAX_TRIP_M = 500_000;
const MAX_ARRIVAL_DISTANCE_M = 500;
const MAX_TRACK_POINTS = 5_000;

@Injectable()
export class TripsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
    private readonly pricing: PricingService,
    private readonly matching: MatchingService,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeEmitter,
    private readonly notifications: NotificationsService,
    private readonly wallet: WalletService,
  ) {}

  /** Devis : le prix affiché est garanti pendant QUOTE_TTL_S via `quoteId`. */
  async estimate(passengerId: string, input: EstimateInput) {
    if (!isInTunisia(input.pickup) || !isInTunisia(input.dropoff)) {
      throw new AppError('OUT_OF_SERVICE_AREA', 'Départ ou arrivée hors zone de service');
    }
    const { distanceM, durationS } = await this.routing.route(input.pickup, input.dropoff);
    if (distanceM < MIN_TRIP_M) throw new AppError('TRIP_TOO_SHORT', 'Trajet trop court');
    if (distanceM > MAX_TRIP_M) throw new AppError('TRIP_TOO_LONG', 'Trajet trop long');

    const { rule, surge, price } = await this.pricing.quote(
      input.pickup,
      input.dropoff,
      input.category,
      distanceM,
      durationS,
    );
    const quoteId = randomUUID();
    const quote: Quote = {
      ...input,
      passengerId,
      distanceM,
      durationS,
      price,
      surge,
      pricingRuleId: rule.id,
      commissionBps: rule.commissionBps,
    };
    const ttl = env().QUOTE_TTL_S;
    await this.redis.set(`quote:${quoteId}`, JSON.stringify(quote), 'EX', ttl);
    return {
      quoteId,
      price,
      currency: 'TND',
      distanceM,
      durationS,
      surge,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  /** Idempotent : le même `Idempotency-Key` renvoie la même course (retry après perte réseau). */
  async request(passengerId: string, quoteId: string, idempotencyKey?: string) {
    const findExisting = async (key: string) =>
      (
        await this.db
          .select()
          .from(trips)
          .where(and(eq(trips.passengerId, passengerId), eq(trips.idempotencyKey, key)))
      )[0];
    if (idempotencyKey) {
      const existing = await findExisting(idempotencyKey);
      if (existing) return this.view(existing);
    }

    const raw = await this.redis.getdel(`quote:${quoteId}`);
    const quote = raw ? (JSON.parse(raw) as Quote) : null;
    if (!quote || quote.passengerId !== passengerId) {
      throw new AppError('QUOTE_EXPIRED', 'Devis expiré, refaire une estimation', HttpStatus.GONE);
    }

    let trip: Trip;
    try {
      [trip] = (await this.db
        .insert(trips)
        .values({
          passengerId,
          category: quote.category,
          pickup: quote.pickup,
          pickupAddress: quote.pickupAddress,
          dropoff: quote.dropoff,
          dropoffAddress: quote.dropoffAddress,
          estimatedDistanceM: quote.distanceM,
          estimatedDurationS: quote.durationS,
          quotedPrice: quote.price,
          surgeMultiplier: quote.surge.toFixed(2),
          pricingRuleId: quote.pricingRuleId,
          commissionBps: quote.commissionBps,
          paymentMethod: 'cash',
          idempotencyKey,
        })
        .returning()) as [Trip];
    } catch (e) {
      const constraint = uniqueViolation(e);
      if (constraint === 'trips_one_active_per_passenger') {
        throw Errors.conflict('ACTIVE_TRIP_EXISTS', 'Une course est déjà en cours');
      }
      // Deux requêtes concurrentes avec la même clé : la seconde renvoie la course créée par la première.
      const raced = constraint === 'trips_idempotency' && idempotencyKey ? await findExisting(idempotencyKey) : undefined;
      if (raced) return this.view(raced);
      throw e;
    }

    await this.db.insert(tripEvents).values({ tripId: trip.id, toStatus: 'requested', actorId: passengerId });
    await this.matching.enqueueDispatch(trip.id);
    return this.view(trip);
  }

  async get(userId: string, tripId: string) {
    const trip = await this.findForParticipant(userId, tripId);
    return this.view(trip);
  }

  /** Reprise après reconnexion : l'app interroge ceci au démarrage, le WebSocket n'est pas la source de vérité. */
  async active(userId: string) {
    const [trip] = await this.db
      .select()
      .from(trips)
      .where(
        and(
          or(eq(trips.passengerId, userId), eq(trips.driverId, userId)),
          inArray(trips.status, [...ACTIVE_TRIP_STATUSES]),
        ),
      )
      .orderBy(desc(trips.requestedAt))
      .limit(1);
    const [pendingOffer] = await this.db
      .select()
      .from(tripOffers)
      .where(and(eq(tripOffers.driverId, userId), eq(tripOffers.status, 'pending')));
    return { trip: trip ? await this.view(trip) : null, pendingOffer: pendingOffer ?? null };
  }

  async accept(driverId: string, tripId: string) {
    const state = await this.presence.getState(driverId);
    if (!state || state.status !== 'online') {
      throw new AppError('DRIVER_NOT_AVAILABLE', 'Passer en ligne pour accepter une course', HttpStatus.CONFLICT);
    }

    const trip = await this.db.transaction(async (tx) => {
      const accepted = await tx
        .update(tripOffers)
        .set({ status: 'accepted', respondedAt: new Date() })
        .where(and(eq(tripOffers.tripId, tripId), eq(tripOffers.driverId, driverId), eq(tripOffers.status, 'pending')))
        .returning();
      if (accepted.length === 0) return null;

      const [assigned] = await tx
        .update(trips)
        .set({
          status: 'driver_assigned',
          driverId,
          vehicleId: state.vehicleId,
          offeredDriverId: null,
          assignedAt: new Date(),
        })
        .where(and(eq(trips.id, tripId), eq(trips.status, 'requested'), eq(trips.offeredDriverId, driverId)))
        .returning();
      if (!assigned) {
        tx.rollback();
        return null;
      }
      await tx
        .insert(tripEvents)
        .values({ tripId, fromStatus: 'requested', toStatus: 'driver_assigned', actorId: driverId });
      return assigned;
    }).catch((e: unknown) => {
      if ((e as Error)?.name === 'TransactionRollbackError') return null;
      throw e;
    });
    if (!trip) throw new AppError('OFFER_NOT_AVAILABLE', "L'offre a expiré ou a été annulée", HttpStatus.CONFLICT);

    await this.presence.markOnTrip(driverId, tripId, trip.passengerId);
    await this.presence.releaseLock(driverId, tripId);
    return this.publish(trip);
  }

  async decline(driverId: string, tripId: string) {
    const offer = await this.matching.pendingOfferFor(tripId);
    if (!offer || offer.driverId !== driverId) {
      throw new AppError('OFFER_NOT_AVAILABLE', "L'offre a expiré ou a été annulée", HttpStatus.CONFLICT);
    }
    await this.matching.closeOffer(offer.id, 'declined');
  }

  async markArrived(driverId: string, tripId: string) {
    const state = await this.presence.getState(driverId);
    const trip = await this.findForParticipant(driverId, tripId);
    if (state?.lat !== undefined && state.lng !== undefined) {
      const distance = haversineMeters({ lat: state.lat, lng: state.lng }, trip.pickup);
      if (distance > MAX_ARRIVAL_DISTANCE_M) {
        throw new AppError('TOO_FAR_FROM_PICKUP', 'Trop loin du point de prise en charge', HttpStatus.CONFLICT, {
          distanceM: Math.round(distance),
        });
      }
    }
    return this.driverTransition(driverId, tripId, 'driver_assigned', 'driver_arrived', { arrivedAt: new Date() });
  }

  async start(driverId: string, tripId: string) {
    return this.driverTransition(driverId, tripId, 'driver_arrived', 'in_progress', { startedAt: new Date() });
  }

  /** Tarif garanti : le prix final est le prix du devis. Le paiement cash est créé `pending` jusqu'à l'encaissement. */
  async complete(driverId: string, tripId: string) {
    const trip = await this.findForParticipant(driverId, tripId);
    const view = await this.driverTransition(
      driverId,
      tripId,
      'in_progress',
      'completed',
      { completedAt: new Date(), finalPrice: trip.quotedPrice },
      (completed) => this.ensurePayment(completed),
    );
    await this.presence.markAvailable(driverId);
    return view;
  }

  /** Le chauffeur confirme avoir encaissé la course en espèces. Idempotent. */
  async confirmCashCollected(driverId: string, tripId: string) {
    const trip = await this.findForParticipant(driverId, tripId);
    if (trip.driverId !== driverId) throw Errors.notFound('Course');
    if (trip.status !== 'completed') {
      throw Errors.conflict('TRIP_NOT_COMPLETED', 'La course doit être terminée');
    }
    if (trip.paymentMethod !== 'cash') {
      throw Errors.conflict('PAYMENT_NOT_CASH', 'Cette course ne se règle pas en espèces');
    }
    const payment = await this.ensurePayment(trip);
    if (payment.status === 'pending') {
      // Encaissement et commission dans la même transaction : jamais l'un sans l'autre. Le chauffeur a gardé le prix
      // en espèces, il doit donc la commission à la plateforme (voir le module portefeuille).
      let change: BalanceChange | null = null;
      await this.db.transaction(async (tx) => {
        const paid = await tx
          .update(payments)
          .set({ status: 'succeeded' })
          .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
          .returning({ id: payments.id });
        if (paid.length > 0) change = await this.wallet.recordCommission(tx, { ...trip, driverId });
      });
      if (change) await this.wallet.afterChange(driverId, change);
    }
    return this.publish(trip, false); // statut inchangé : pas de nouvelle notification
  }

  /**
   * Trace GPS enregistrée pendant la course (du moment où le chauffeur accepte jusqu'à la fin).
   * Sans `participantId` : accès back-office, sans contrôle de participation.
   */
  async track(tripId: string, participantId?: string) {
    const trip = participantId
      ? await this.findForParticipant(participantId, tripId)
      : (await this.db.select().from(trips).where(eq(trips.id, tripId)))[0];
    if (!trip) throw Errors.notFound('Course');

    const rows = await this.db
      .select({ point: locationPoints.point, recordedAt: locationPoints.recordedAt })
      .from(locationPoints)
      .where(eq(locationPoints.tripId, tripId))
      .orderBy(asc(locationPoints.recordedAt))
      .limit(MAX_TRACK_POINTS);
    const points = rows.map((r) => ({ lat: r.point.lat, lng: r.point.lng, ts: r.recordedAt.getTime() }));
    let travelledDistanceM = 0;
    for (let i = 1; i < points.length; i++) travelledDistanceM += haversineMeters(points[i - 1]!, points[i]!);
    return { tripId, status: trip.status, points, travelledDistanceM: Math.round(travelledDistanceM) };
  }

  /** Notation bidirectionnelle : chaque participant note l'autre une seule fois, une fois la course terminée. */
  async rate(userId: string, tripId: string, score: number, comment?: string) {
    const trip = await this.findForParticipant(userId, tripId);
    if (trip.status !== 'completed' || !trip.driverId) {
      throw Errors.conflict('TRIP_NOT_COMPLETED', 'La course doit être terminée');
    }
    const rateeId = trip.passengerId === userId ? trip.driverId : trip.passengerId;

    try {
      return await this.db.transaction(async (tx) => {
        // Verrou sur le noté : la moyenne est recalculée sur un état à jour même si deux notes arrivent en même temps.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, rateeId)).for('update');
        const [rating] = await tx
          .insert(ratings)
          .values({ tripId, raterId: userId, rateeId, score, comment })
          .returning();
        await tx
          .update(users)
          .set({
            ratingAvg: sql`(SELECT ROUND(AVG(${ratings.score}), 2) FROM ${ratings} WHERE ${ratings.rateeId} = ${rateeId})`,
            ratingCount: sql`(SELECT COUNT(*)::int FROM ${ratings} WHERE ${ratings.rateeId} = ${rateeId})`,
          })
          .where(eq(users.id, rateeId));
        return rating;
      });
    } catch (e) {
      if (uniqueViolation(e) === 'ratings_one_per_rater') {
        throw Errors.conflict('ALREADY_RATED', 'Vous avez déjà noté cette course');
      }
      throw e;
    }
  }

  /**
   * Historique paginé (plus récent d'abord). `cursor` = `requestedAt` du dernier élément reçu.
   * Chaque côté voit l'autre partie : le passager le chauffeur et son véhicule, le chauffeur le passager.
   */
  async history(userId: string, limit: number, cursor?: Date) {
    const counterpart = alias(users, 'counterpart');
    const rows = await this.db
      .select({
        trip: trips,
        counterpart: {
          id: counterpart.id,
          fullName: counterpart.fullName,
          photoUrl: counterpart.photoUrl,
          rating: counterpart.ratingAvg,
        },
        vehicle: { make: vehicles.make, model: vehicles.model, color: vehicles.color, plate: vehicles.plate },
        myRating: ratings.score,
      })
      .from(trips)
      .leftJoin(
        counterpart,
        eq(
          counterpart.id,
          sql`CASE WHEN ${trips.passengerId} = ${userId} THEN ${trips.driverId} ELSE ${trips.passengerId} END`,
        ),
      )
      .leftJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .leftJoin(ratings, and(eq(ratings.tripId, trips.id), eq(ratings.raterId, userId)))
      .where(
        and(
          or(eq(trips.passengerId, userId), eq(trips.driverId, userId)),
          // Postgres stocke des microsecondes, le curseur JS des millisecondes : on compare à la milliseconde.
          cursor ? sql`date_trunc('milliseconds', ${trips.requestedAt}) < ${cursor}` : undefined,
        ),
      )
      .orderBy(desc(trips.requestedAt))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const items = page.map(({ trip, counterpart: other, vehicle, myRating }) => {
      const { idempotencyKey: _k, offeredDriverId: _o, pricingRuleId: _p, ...publicFields } = trip;
      const passengerSide = trip.passengerId === userId;
      return {
        ...publicFields,
        counterpart: other?.id ? other : null,
        vehicle: passengerSide && trip.vehicleId ? vehicle : null,
        myRating: myRating ?? null,
      };
    });
    const last = page.at(-1)?.trip;
    return { items, nextCursor: rows.length > limit && last ? last.requestedAt.toISOString() : null };
  }

  async cancel(userId: string, tripId: string, reason?: string) {
    const trip = await this.findForParticipant(userId, tripId);
    const byPassenger = trip.passengerId === userId;
    const allowed: TripStatus[] = byPassenger
      ? ['requested', 'driver_assigned', 'driver_arrived']
      : ['driver_assigned', 'driver_arrived'];
    if (!allowed.includes(trip.status)) {
      throw new AppError('TRIP_NOT_CANCELLABLE', `Annulation impossible au statut ${trip.status}`, HttpStatus.CONFLICT);
    }

    const fee = byPassenger ? await this.cancellationFee(trip) : 0;
    const [cancelled] = await this.db
      .update(trips)
      .set({
        status: byPassenger ? 'cancelled_by_passenger' : 'cancelled_by_driver',
        cancelledAt: new Date(),
        cancelReason: reason,
        cancellationFee: fee,
      })
      .where(and(eq(trips.id, tripId), eq(trips.status, trip.status)))
      .returning();
    if (!cancelled) throw Errors.conflict('TRIP_STATE_CHANGED', 'La course a changé entre-temps, recharger');

    await this.db.insert(tripEvents).values({
      tripId,
      fromStatus: trip.status,
      toStatus: cancelled.status,
      actorId: userId,
      meta: { reason, fee },
    });

    const pending = await this.matching.pendingOfferFor(tripId);
    if (pending) await this.matching.closeOffer(pending.id, 'cancelled');
    if (trip.driverId) await this.presence.markAvailable(trip.driverId);
    return this.publish(cancelled);
  }

  // ─── internes ──────────────────────────────────────────────────────────────

  /**
   * Gratuit tant que le chauffeur n'est pas assigné ou pendant CANCEL_FREE_WINDOW_S après l'assignation ;
   * payant ensuite, et toujours payant une fois le chauffeur arrivé.
   */
  private async cancellationFee(trip: Trip): Promise<number> {
    const late =
      trip.status === 'driver_arrived' ||
      (trip.status === 'driver_assigned' &&
        !!trip.assignedAt &&
        Date.now() - trip.assignedAt.getTime() > env().CANCEL_FREE_WINDOW_S * 1000);
    if (!late) return 0;
    const rule = await this.pricing.findRule(trip.pickup, trip.dropoff, trip.category);
    return rule.cancellationFee;
  }

  private async driverTransition(
    driverId: string,
    tripId: string,
    from: TripStatus,
    to: TripStatus,
    patch: Partial<typeof trips.$inferInsert>,
    after?: (updated: Trip) => Promise<unknown>,
  ) {
    const [updated] = await this.db
      .update(trips)
      .set({ status: to, ...patch })
      .where(and(eq(trips.id, tripId), eq(trips.driverId, driverId), eq(trips.status, from)))
      .returning();
    if (!updated) throw Errors.conflict('TRIP_STATE_CHANGED', `Transition ${from} → ${to} impossible`);
    await this.db.insert(tripEvents).values({ tripId, fromStatus: from, toStatus: to, actorId: driverId });
    await after?.(updated);
    return this.publish(updated);
  }

  /** Un seul paiement par course : créé à la fin de la course, ou rattrapé ici si cette étape avait échoué. */
  private async ensurePayment(trip: Trip) {
    const [existing] = await this.db.select().from(payments).where(eq(payments.tripId, trip.id));
    if (existing) return existing;
    const [created] = await this.db
      .insert(payments)
      .values({ tripId: trip.id, method: trip.paymentMethod, amount: trip.finalPrice ?? trip.quotedPrice })
      .returning();
    return created!;
  }

  private async findForParticipant(userId: string, tripId: string): Promise<Trip> {
    const [trip] = await this.db.select().from(trips).where(eq(trips.id, tripId));
    if (!trip || (trip.passengerId !== userId && trip.driverId !== userId)) throw Errors.notFound('Course');
    return trip;
  }

  private async publish(trip: Trip, notify = true) {
    const view = await this.view(trip);
    this.realtime.toUser(trip.passengerId, 'trip:updated', view);
    if (trip.driverId) this.realtime.toUser(trip.driverId, 'trip:updated', view);
    if (notify) this.notifyStatus(trip, view.driver);
    return view;
  }

  /** Push + boîte de réception pour les changements de statut qui concernent l'autre partie (sans attendre, sans jamais échouer). */
  private notifyStatus(trip: Trip, driver: { fullName: string | null; vehicle: { plate: string } } | null) {
    const data = { tripId: trip.id, status: trip.status };
    switch (trip.status) {
      case 'driver_assigned':
        void this.notifications.notify(
          trip.passengerId,
          'trip.driver_assigned',
          { driverName: driver?.fullName?.split(' ')[0], plate: driver?.vehicle.plate },
          data,
        );
        break;
      case 'driver_arrived':
        void this.notifications.notify(trip.passengerId, 'trip.driver_arrived', {}, data);
        break;
      case 'completed':
        void this.notifications.notify(trip.passengerId, 'trip.completed', { price: trip.finalPrice ?? trip.quotedPrice }, data);
        break;
      case 'cancelled_by_driver':
        void this.notifications.notify(trip.passengerId, 'trip.cancelled_by_driver', {}, data);
        break;
      case 'cancelled_by_passenger':
        if (trip.driverId) void this.notifications.notify(trip.driverId, 'trip.cancelled_by_passenger', {}, data);
        break;
    }
  }

  private async view(trip: Trip) {
    // Le numéro réel du chauffeur n'est jamais exposé : appel masqué / chat in-app en phase 3.
    let driver = null;
    if (trip.driverId && trip.vehicleId) {
      const [row] = await this.db
        .select({
          id: users.id,
          fullName: users.fullName,
          photoUrl: users.photoUrl,
          rating: users.ratingAvg,
          vehicle: { make: vehicles.make, model: vehicles.model, color: vehicles.color, plate: vehicles.plate },
        })
        .from(users)
        .innerJoin(vehicles, eq(vehicles.id, trip.vehicleId))
        .where(eq(users.id, trip.driverId));
      driver = row ?? null;
    }
    // ETA tant que le chauffeur rejoint le passager, d'après sa dernière position connue.
    let driverEta = null;
    if (trip.status === 'driver_assigned' && trip.driverId) {
      const state = await this.presence.getState(trip.driverId);
      if (state?.lat !== undefined && state.lng !== undefined) {
        const { distanceM, durationS } = await this.routing.route({ lat: state.lat, lng: state.lng }, trip.pickup);
        driverEta = { distanceM, durationS, updatedAt: state.lastSeen ?? null };
      }
    }
    let payment = null;
    if (trip.status === 'completed') {
      [payment = null] = await this.db
        .select({ method: payments.method, amount: payments.amount, status: payments.status })
        .from(payments)
        .where(eq(payments.tripId, trip.id));
    }
    const { idempotencyKey: _k, offeredDriverId: _o, pricingRuleId: _p, ...publicFields } = trip;
    return { ...publicFields, driver, driverEta, payment };
  }
}
