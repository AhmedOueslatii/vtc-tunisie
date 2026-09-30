import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { DB, type Db } from '../../db/db.js';
import { tripEvents, tripOffers, trips, users } from '../../db/schema.js';
import { MATCHING_QUEUE, RealtimeEmitter } from '../../infra/infra.module.js';
import { PresenceService } from '../drivers/presence.service.js';

type OfferOutcome = 'declined' | 'expired' | 'cancelled';

/**
 * Matching séquentiel : la course est proposée à un seul chauffeur à la fois, le plus proche,
 * avec un délai de réponse. Refus ou expiration ⇒ chauffeur suivant ; les rayons s'élargissent.
 *
 * Invariant : `trips.offered_driver_id` n'est non nul que pendant une offre en attente. Toutes les
 * écritures sont conditionnelles (`WHERE status = 'requested' AND offered_driver_id …`) pour
 * rester correctes avec plusieurs workers et des événements concurrents.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MATCHING_QUEUE) private readonly queue: Queue,
    private readonly presence: PresenceService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async enqueueDispatch(tripId: string, delayMs = 0): Promise<void> {
    await this.queue.add('dispatch', { tripId }, { delay: delayMs, removeOnComplete: true, removeOnFail: 1000 });
  }

  async dispatch(tripId: string): Promise<void> {
    const [trip] = await this.db.select().from(trips).where(eq(trips.id, tripId));
    if (!trip || trip.status !== 'requested' || trip.offeredDriverId) return;

    const { MATCHING_RADII_M, MATCHING_OFFER_TIMEOUT_S, MATCHING_MAX_SEARCH_S, MATCHING_RETRY_DELAY_S } = env();
    const alreadyAsked = await this.db
      .select({ driverId: tripOffers.driverId })
      .from(tripOffers)
      .where(eq(tripOffers.tripId, tripId));
    const excluded = new Set(alreadyAsked.map((o) => o.driverId));

    for (const radius of MATCHING_RADII_M) {
      for (const candidate of await this.presence.findCandidates(trip.pickup, radius, trip.category)) {
        if (excluded.has(candidate.driverId)) continue;
        excluded.add(candidate.driverId);

        const timeoutMs = MATCHING_OFFER_TIMEOUT_S * 1000;
        if (!(await this.presence.tryLock(candidate.driverId, tripId, timeoutMs + 5_000))) continue;

        const claimed = await this.db
          .update(trips)
          .set({ offeredDriverId: candidate.driverId })
          .where(and(eq(trips.id, tripId), eq(trips.status, 'requested'), isNull(trips.offeredDriverId)))
          .returning({ id: trips.id });
        if (claimed.length === 0) {
          await this.presence.releaseLock(candidate.driverId, tripId);
          return; // annulée ou déjà proposée par un autre worker
        }

        const expiresAt = new Date(Date.now() + timeoutMs);
        const [offer] = await this.db
          .insert(tripOffers)
          .values({ tripId, driverId: candidate.driverId, distanceM: candidate.distanceM, expiresAt })
          .returning();
        await this.queue.add(
          'offer-timeout',
          { offerId: offer!.id },
          { delay: timeoutMs, jobId: `offer-timeout-${offer!.id}`, removeOnComplete: true, removeOnFail: 1000 },
        );

        const [passenger] = await this.db
          .select({ fullName: users.fullName, ratingAvg: users.ratingAvg })
          .from(users)
          .where(eq(users.id, trip.passengerId));
        this.realtime.toUser(candidate.driverId, 'trip:offer', {
          offerId: offer!.id,
          expiresAt,
          distanceToPickupM: candidate.distanceM,
          trip: {
            id: trip.id,
            pickup: trip.pickup,
            pickupAddress: trip.pickupAddress,
            dropoff: trip.dropoff,
            dropoffAddress: trip.dropoffAddress,
            estimatedDistanceM: trip.estimatedDistanceM,
            estimatedDurationS: trip.estimatedDurationS,
            price: trip.quotedPrice,
            paymentMethod: trip.paymentMethod,
            passenger: { firstName: passenger?.fullName?.split(' ')[0] ?? null, rating: passenger?.ratingAvg ?? null },
          },
        });
        this.logger.log(`course ${tripId} → offre au chauffeur ${candidate.driverId} (${candidate.distanceM} m)`);
        return;
      }
    }

    if (Date.now() - trip.requestedAt.getTime() < MATCHING_MAX_SEARCH_S * 1000) {
      await this.enqueueDispatch(tripId, MATCHING_RETRY_DELAY_S * 1000);
      return;
    }

    const failed = await this.db
      .update(trips)
      .set({ status: 'no_driver_found' })
      .where(and(eq(trips.id, tripId), eq(trips.status, 'requested'), isNull(trips.offeredDriverId)))
      .returning({ id: trips.id });
    if (failed.length > 0) {
      await this.db.insert(tripEvents).values({ tripId, fromStatus: 'requested', toStatus: 'no_driver_found' });
      this.realtime.toUser(trip.passengerId, 'trip:updated', { id: tripId, status: 'no_driver_found' });
    }
  }

  async onOfferTimeout(offerId: string): Promise<void> {
    await this.closeOffer(offerId, 'expired');
  }

  /**
   * Clôt une offre en attente. Renvoie la ligne clôturée, ou `null` si le chauffeur avait déjà
   * répondu (la première réponse gagne). Relance le dispatch sauf si la course est annulée.
   */
  async closeOffer(offerId: string, outcome: OfferOutcome) {
    const [offer] = await this.db
      .update(tripOffers)
      .set({ status: outcome, respondedAt: new Date() })
      .where(and(eq(tripOffers.id, offerId), eq(tripOffers.status, 'pending')))
      .returning();
    if (!offer) return null;

    await this.db
      .update(trips)
      .set({ offeredDriverId: null })
      .where(and(eq(trips.id, offer.tripId), eq(trips.offeredDriverId, offer.driverId)));
    await this.presence.releaseLock(offer.driverId, offer.tripId);
    await this.queue.remove(`offer-timeout-${offer.id}`).catch(() => undefined);

    if (outcome === 'expired') this.realtime.toUser(offer.driverId, 'trip:offer_expired', { offerId });
    if (outcome === 'cancelled') this.realtime.toUser(offer.driverId, 'trip:offer_cancelled', { offerId });
    if (outcome !== 'cancelled') await this.enqueueDispatch(offer.tripId);
    return offer;
  }

  async pendingOfferFor(tripId: string) {
    const [offer] = await this.db
      .select()
      .from(tripOffers)
      .where(and(eq(tripOffers.tripId, tripId), eq(tripOffers.status, 'pending')));
    return offer ?? null;
  }
}
