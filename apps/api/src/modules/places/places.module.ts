import { Controller, Get, HttpStatus, Inject, Injectable, Module, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { isInTunisia, type LatLng } from '../../common/geo.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { env } from '../../config/env.js';
import { REDIS } from '../../infra/infra.module.js';
import { CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/tokens.service.js';
import {
  GEOCODING_PROVIDER,
  type GeocodingProvider,
  NominatimGeocodingProvider,
  normalizeText,
  type Place,
  StaticGeocodingProvider,
} from './geocoding.provider.js';

const MAX_REQUESTS_PER_MINUTE = 60;
const SEARCH_TTL_S = 3_600;
const REVERSE_TTL_S = 86_400;

const searchSchema = z
  .object({
    q: z.string().trim().min(2).max(100),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    limit: z.coerce.number().int().min(1).max(10).default(5),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), { path: ['lat'], message: 'lat et lng vont ensemble' });
const reverseSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

@Injectable()
export class PlacesService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(GEOCODING_PROVIDER) private readonly provider: GeocodingProvider,
  ) {}

  /** Autocomplétion d'adresses : limitée par utilisateur (le fournisseur externe est le goulot) et mise en cache. */
  async search(userId: string, q: string, near: LatLng | undefined, limit: number): Promise<Place[]> {
    if (near && !isInTunisia(near)) throw outOfArea();
    await this.throttle(userId);
    // Position arrondie à ~1 km : assez fin pour le biais de proximité, assez large pour que le cache serve.
    const bias = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : '-';
    return this.cached(`places:s:${normalizeText(q)}:${bias}:${limit}`, SEARCH_TTL_S, () =>
      this.provider.search(q, near, limit),
    );
  }

  async reverse(userId: string, point: LatLng): Promise<Place | null> {
    if (!isInTunisia(point)) throw outOfArea();
    await this.throttle(userId);
    return this.cached(`places:r:${point.lat.toFixed(4)},${point.lng.toFixed(4)}`, REVERSE_TTL_S, () =>
      this.provider.reverse(point),
    );
  }

  private async throttle(userId: string) {
    const key = `places:rl:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 60);
    if (count > MAX_REQUESTS_PER_MINUTE) {
      throw new AppError('RATE_LIMITED', 'Trop de recherches, patienter', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async cached<T>(key: string, ttlS: number, load: () => Promise<T>): Promise<T> {
    const hit = await this.redis.get(key);
    if (hit) return JSON.parse(hit) as T;
    const value = await load();
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlS);
    return value;
  }
}

const outOfArea = () => new AppError('OUT_OF_SERVICE_AREA', 'Position hors zone de service');

@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  /** Autocomplétion du départ et de la destination (Tunisie uniquement). `lat`/`lng` : position de l'utilisateur, pour trier par proximité. */
  @Get('search')
  @ApiQuery({ name: 'q', required: true, description: '2 à 100 caractères, français ou arabe' })
  @ApiQuery({ name: 'lat', required: false })
  @ApiQuery({ name: 'lng', required: false })
  @ApiQuery({ name: 'limit', required: false, description: '1 à 10 (défaut 5)' })
  search(@CurrentUser() user: AuthUser, @Query(new ZodPipe(searchSchema)) query: z.infer<typeof searchSchema>) {
    const near = query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : undefined;
    return this.places.search(user.id, query.q, near, query.limit);
  }

  /** Adresse à partir d'un point posé sur la carte ; `null` si rien d'identifiable. */
  @Get('reverse')
  @ApiQuery({ name: 'lat', required: true })
  @ApiQuery({ name: 'lng', required: true })
  async reverse(@CurrentUser() user: AuthUser, @Query(new ZodPipe(reverseSchema)) query: z.infer<typeof reverseSchema>) {
    return { place: await this.places.reverse(user.id, query) };
  }
}

@Module({
  controllers: [PlacesController],
  providers: [
    PlacesService,
    {
      provide: GEOCODING_PROVIDER,
      useFactory: (): GeocodingProvider =>
        env().GEOCODING_PROVIDER === 'nominatim' ? new NominatimGeocodingProvider() : new StaticGeocodingProvider(),
    },
  ],
})
export class PlacesModule {}
