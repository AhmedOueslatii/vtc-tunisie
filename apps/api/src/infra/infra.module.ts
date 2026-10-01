import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { env } from '../config/env.js';
import { createDb, DB } from '../db/db.js';
import { LocalObjectStorage, STORAGE } from './storage.js';

export const REDIS = Symbol('REDIS');
export const PG_POOL = Symbol('PG_POOL');
export const MATCHING_QUEUE = Symbol('MATCHING_QUEUE');

/** Connexion dédiée à BullMQ (elle exige `maxRetriesPerRequest: null`). */
export function createBullConnection(): Redis {
  return new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
}

export type MatchingJob =
  | { name: 'dispatch'; data: { tripId: string } }
  | { name: 'offer-timeout'; data: { offerId: string } }
  | { name: 'sweep-stale-drivers'; data: Record<string, never> }
  | { name: 'purge-location-points'; data: Record<string, never> };

/**
 * Émission Socket.IO via Redis : fonctionne depuis n'importe quel processus (api ou worker),
 * les instances api relaient aux clients connectés grâce à l'adaptateur Redis.
 */
@Injectable()
export class RealtimeEmitter {
  private readonly emitter: Emitter;

  constructor(@Inject(REDIS) redis: Redis) {
    this.emitter = new Emitter(redis).of('/rt');
  }

  toUser(userId: string, event: string, payload: unknown): void {
    this.emitter.to(`user:${userId}`).emit(event, payload);
  }
}

@Injectable()
class Shutdown implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(MATCHING_QUEUE) private readonly queue: Queue,
  ) {}

  async onApplicationShutdown() {
    await this.queue.close();
    await this.redis.quit();
    await this.pool.end();
  }
}

const database = createDb(env().DATABASE_URL);

@Global()
@Module({
  providers: [
    { provide: PG_POOL, useValue: database.pool },
    { provide: DB, useValue: database.db },
    { provide: REDIS, useFactory: () => new Redis(env().REDIS_URL) },
    { provide: MATCHING_QUEUE, useFactory: () => new Queue('matching', { connection: createBullConnection() }) },
    { provide: STORAGE, useClass: LocalObjectStorage },
    RealtimeEmitter,
    Shutdown,
  ],
  exports: [DB, REDIS, MATCHING_QUEUE, STORAGE, RealtimeEmitter],
})
export class InfraModule {}
