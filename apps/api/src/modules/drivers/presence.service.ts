import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { LatLng } from '../../common/geo.js';
import { env } from '../../config/env.js';
import { REDIS } from '../../infra/infra.module.js';

export type VehicleCategory = 'standard' | 'premium' | 'van';

export interface DriverState {
  status: 'online' | 'on_trip';
  category: VehicleCategory;
  vehicleId: string;
  lat?: number;
  lng?: number;
  /** Horodatage serveur (ms) de la dernière position reçue. */
  lastSeen?: number;
  /** Horodatage client (ms) de la dernière position : sert à ignorer les points arrivés dans le désordre. */
  lastTs?: number;
  tripId?: string;
  passengerId?: string;
}

export interface Candidate {
  driverId: string;
  distanceM: number;
}

/**
 * Présence et positions des chauffeurs, entièrement dans Redis (jamais dans Postgres) :
 *   driver:state:{id}        hash  — état courant
 *   geo:drivers:{catégorie}  GEO   — uniquement les chauffeurs `online` (disponibles)
 *   driver:offer_lock:{id}   str   — empêche d'envoyer deux offres simultanées au même chauffeur
 */
@Injectable()
export class PresenceService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async getState(driverId: string): Promise<DriverState | null> {
    const raw = await this.redis.hgetall(stateKey(driverId));
    if (!raw.status) return null;
    return {
      status: raw.status as DriverState['status'],
      category: raw.category as VehicleCategory,
      vehicleId: raw.vehicleId!,
      lat: num(raw.lat),
      lng: num(raw.lng),
      lastSeen: num(raw.lastSeen),
      lastTs: num(raw.lastTs),
      tripId: raw.tripId || undefined,
      passengerId: raw.passengerId || undefined,
    };
  }

  async goOnline(driverId: string, category: VehicleCategory, vehicleId: string): Promise<void> {
    const previous = await this.getState(driverId);
    if (previous && previous.category !== category) await this.redis.zrem(geoKey(previous.category), driverId);
    await this.redis.hset(stateKey(driverId), { status: 'online', category, vehicleId });
    if (previous?.lat !== undefined && previous.lng !== undefined && this.isFresh(previous)) {
      await this.redis.geoadd(geoKey(category), previous.lng, previous.lat, driverId);
    }
  }

  async goOffline(driverId: string): Promise<void> {
    const state = await this.getState(driverId);
    if (!state) return;
    await this.redis.multi().zrem(geoKey(state.category), driverId).del(stateKey(driverId)).exec();
  }

  /** Renvoie l'état mis à jour, ou `null` si le chauffeur n'est pas en ligne. */
  async updateLocation(driverId: string, point: LatLng, clientTs: number): Promise<DriverState | null> {
    const state = await this.getState(driverId);
    if (!state) return null;
    if (state.lastTs !== undefined && clientTs <= state.lastTs) return state;

    const tx = this.redis
      .multi()
      .hset(stateKey(driverId), { lat: point.lat, lng: point.lng, lastSeen: Date.now(), lastTs: clientTs });
    if (state.status === 'online') tx.geoadd(geoKey(state.category), point.lng, point.lat, driverId);
    await tx.exec();
    return { ...state, ...point, lastSeen: Date.now(), lastTs: clientTs };
  }

  /** Chauffeurs disponibles et à jour dans le rayon, du plus proche au plus éloigné. */
  async findCandidates(from: LatLng, radiusM: number, category: VehicleCategory, limit = 10): Promise<Candidate[]> {
    const hits = (await this.redis.geosearch(
      geoKey(category),
      'FROMLONLAT',
      from.lng,
      from.lat,
      'BYRADIUS',
      radiusM,
      'm',
      'ASC',
      'COUNT',
      limit,
      'WITHDIST',
    )) as [string, string][];
    if (hits.length === 0) return [];

    const pipeline = this.redis.pipeline();
    for (const [id] of hits) pipeline.hmget(stateKey(id), 'status', 'lastSeen');
    const states = (await pipeline.exec()) ?? [];

    const staleBefore = Date.now() - env().DRIVER_STALE_AFTER_S * 1000;
    return hits.flatMap(([driverId, dist], i) => {
      const [status, lastSeen] = (states[i]?.[1] as (string | null)[] | undefined) ?? [];
      const fresh = Number(lastSeen) >= staleBefore;
      return status === 'online' && fresh ? [{ driverId, distanceM: Math.round(Number(dist)) }] : [];
    });
  }

  async markOnTrip(driverId: string, tripId: string, passengerId: string): Promise<void> {
    const state = await this.getState(driverId);
    const tx = this.redis.multi().hset(stateKey(driverId), { status: 'on_trip', tripId, passengerId });
    if (state) tx.zrem(geoKey(state.category), driverId);
    await tx.exec();
  }

  async markAvailable(driverId: string): Promise<void> {
    const state = await this.getState(driverId);
    if (!state) return;
    const tx = this.redis
      .multi()
      .hset(stateKey(driverId), { status: 'online' })
      .hdel(stateKey(driverId), 'tripId', 'passengerId');
    if (state.lat !== undefined && state.lng !== undefined) {
      tx.geoadd(geoKey(state.category), state.lng, state.lat, driverId);
    }
    await tx.exec();
  }

  async tryLock(driverId: string, tripId: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(lockKey(driverId), tripId, 'PX', ttlMs, 'NX')) === 'OK';
  }

  /** Ne libère que le verrou posé pour cette course (compare-and-delete atomique). */
  async releaseLock(driverId: string, tripId: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey(driverId),
      tripId,
    );
  }

  /** Retire des index GEO les chauffeurs qui n'envoient plus de position (app tuée, perte réseau). */
  async sweepStale(): Promise<number> {
    const staleBefore = Date.now() - env().DRIVER_STALE_AFTER_S * 1000;
    let removed = 0;
    for (const category of ['standard', 'premium', 'van'] as const) {
      const ids = await this.redis.zrange(geoKey(category), '0', '-1');
      if (ids.length === 0) continue;
      const pipeline = this.redis.pipeline();
      for (const id of ids) pipeline.hget(stateKey(id), 'lastSeen');
      const results = (await pipeline.exec()) ?? [];
      const stale = ids.filter((_, i) => Number(results[i]?.[1] ?? 0) < staleBefore);
      if (stale.length > 0) removed += await this.redis.zrem(geoKey(category), ...stale);
    }
    return removed;
  }

  private isFresh(state: DriverState): boolean {
    return (state.lastSeen ?? 0) >= Date.now() - env().DRIVER_STALE_AFTER_S * 1000;
  }
}

const stateKey = (id: string) => `driver:state:${id}`;
const geoKey = (category: VehicleCategory) => `geo:drivers:${category}`;
const lockKey = (id: string) => `driver:offer_lock:${id}`;
const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));
