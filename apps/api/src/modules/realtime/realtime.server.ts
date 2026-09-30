import { Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server as HttpServer } from 'node:http';
import type { Redis } from 'ioredis';
import { Server, type Socket } from 'socket.io';
import { env } from '../../config/env.js';
import { REDIS } from '../../infra/infra.module.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { TokensService } from '../auth/tokens.service.js';
import { locationPointSchema } from '../drivers/drivers.controller.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { DriversService } from '../drivers/drivers.service.js';

type Ack = (response: { ok: boolean; code?: string }) => void;

/**
 * Serveur Socket.IO (namespace `/rt`), authentifié par le jeton d'accès au handshake.
 * Chaque utilisateur rejoint la room `user:{id}` ; toutes les émissions passent par
 * `RealtimeEmitter` (Redis) pour fonctionner sur plusieurs instances.
 */
@Injectable()
export class RealtimeServer implements OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeServer.name);
  private io?: Server;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly tokens: TokensService,
    private readonly drivers: DriversService,
  ) {}

  attach(http: HttpServer): void {
    const origins = env().CORS_ORIGINS.split(',').filter(Boolean);
    const io = new Server(http, {
      cors: { origin: origins },
      // Réseaux mobiles : ping espacé et tolérant. Les événements manqués pendant une coupure
      // ne sont pas rejoués — l'app se resynchronise via GET /v1/trips/active à la reconnexion.
      pingInterval: 20_000,
      pingTimeout: 25_000,
    });
    io.adapter(createAdapter(this.redis.duplicate(), this.redis.duplicate()));

    const nsp = io.of('/rt');
    nsp.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token as string | undefined;
        if (!token) throw new Error('jeton manquant');
        socket.data.user = await this.tokens.verifyAccess(token);
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });
    nsp.on('connection', (socket) => this.onConnection(socket));
    this.io = io;
  }

  private onConnection(socket: Socket) {
    const user = socket.data.user as AuthUser;
    void socket.join(`user:${user.id}`);

    socket.on('driver:location', async (payload: unknown, ack?: Ack) => {
      const parsed = locationPointSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, code: 'VALIDATION_FAILED' });
      try {
        const { accepted } = await this.drivers.updateLocation(user.id, [parsed.data]);
        ack?.({ ok: accepted, code: accepted ? undefined : 'DRIVER_OFFLINE' });
      } catch (e) {
        this.logger.error(`driver:location : ${(e as Error).message}`);
        ack?.({ ok: false, code: 'INTERNAL' });
      }
    });
  }

  async onApplicationShutdown() {
    await this.io?.close();
  }
}

@Module({ imports: [DriversModule], providers: [RealtimeServer], exports: [RealtimeServer] })
export class RealtimeModule {}
