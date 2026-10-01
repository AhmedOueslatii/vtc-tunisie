import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Errors } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import { deviceTokens, notifications, users } from '../../db/schema.js';
import { RealtimeEmitter } from '../../infra/infra.module.js';
import { CurrentUser } from '../auth/auth.guard.js';
import { SMS_PROVIDER, type SmsProvider } from '../auth/sms.provider.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { DEFINITIONS, type NotificationType, type Params, renderNotification } from './messages.js';
import { ConsolePushProvider, PUSH_PROVIDER, type PushMessage, type PushProvider } from './push.provider.js';

const deviceSchema = z.object({ token: z.string().min(8).max(1024), platform: z.enum(['android', 'ios']) });
const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.date().optional(),
});
const unregisterSchema = z.object({ token: z.string().min(8).max(1024) });

/**
 * Point d'entrée unique des notifications. `notify` ne lève jamais : un SMS ou un push qui échoue
 * ne doit pas faire échouer une course. Canaux : boîte de réception + temps réel, push, SMS (critiques).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async notify(userId: string, type: NotificationType, params: Params = {}, data: Record<string, string> = {}) {
    try {
      const [user] = await this.db.select({ locale: users.locale, phone: users.phone }).from(users).where(eq(users.id, userId));
      if (!user) return;

      const definition = DEFINITIONS[type];
      const message = renderNotification(type, user.locale, params);
      const pushData = { type, ...data };

      if (definition.inbox) {
        const [row] = await this.db
          .insert(notifications)
          .values({ userId, type, payload: { ...message, data: pushData } })
          .returning();
        this.realtime.toUser(userId, 'notification:new', row);
      }

      const channels = [this.sendPush(userId, { ...message, data: pushData })];
      if (definition.sms) channels.push(this.sms.send(user.phone, `${message.title} — ${message.body}`));
      for (const result of await Promise.allSettled(channels)) {
        if (result.status === 'rejected') this.logger.error(`${type} → ${userId} : ${String(result.reason)}`);
      }
    } catch (e) {
      this.logger.error(`${type} → ${userId} : ${(e as Error).message}`);
    }
  }

  async list(userId: string, limit: number, cursor?: Date) {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          // Postgres stocke des microsecondes, le curseur JS des millisecondes : on compare à la milliseconde.
          cursor ? sql`date_trunc('milliseconds', ${notifications.createdAt}) < ${cursor}` : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit + 1);
    const [{ unread } = { unread: 0 }] = await this.db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return { items, unread, nextCursor: rows.length > limit && last ? last.createdAt.toISOString() : null };
  }

  async markRead(userId: string, id: string) {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: sql`COALESCE(${notifications.readAt}, now())` })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    if (!row) throw Errors.notFound('Notification');
    return row;
  }

  async markAllRead(userId: string) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }

  /** Un jeton appartient à un seul utilisateur : s'il change de compte sur l'appareil, il est réattribué. */
  async registerDevice(userId: string, token: string, platform: 'android' | 'ios') {
    await this.db
      .insert(deviceTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({ target: deviceTokens.token, set: { userId, platform, lastSeenAt: new Date() } });
  }

  async unregisterDevice(userId: string, token: string) {
    await this.db.delete(deviceTokens).where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.token, token)));
  }

  private async sendPush(userId: string, message: PushMessage) {
    const rows = await this.db.select({ token: deviceTokens.token }).from(deviceTokens).where(eq(deviceTokens.userId, userId));
    if (rows.length === 0) return;
    const { invalidTokens } = await this.push.send(
      rows.map((r) => r.token),
      message,
    );
    if (invalidTokens.length > 0) await this.db.delete(deviceTokens).where(inArray(deviceTokens.token, invalidTokens));
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Boîte de réception, plus récent d'abord, avec le nombre de non-lues. */
  @Get()
  @ApiQuery({ name: 'limit', required: false, description: '1 à 50 (défaut 20)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor de la page précédente' })
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.notifications.list(user.id, query.limit, query.cursor);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(user.id, id);
  }

  /** À appeler à chaque démarrage de l'app : le jeton push peut changer. */
  @Put('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  registerDevice(@CurrentUser() user: AuthUser, @Body(new ZodPipe(deviceSchema)) body: z.infer<typeof deviceSchema>) {
    return this.notifications.registerDevice(user.id, body.token, body.platform);
  }

  /** À appeler à la déconnexion, pour ne plus recevoir les notifications de ce compte sur l'appareil. */
  @Delete('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiQuery({ name: 'token', required: true })
  unregisterDevice(@CurrentUser() user: AuthUser, @Query(new ZodPipe(unregisterSchema)) query: z.infer<typeof unregisterSchema>) {
    return this.notifications.unregisterDevice(user.id, query.token);
  }
}

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, { provide: PUSH_PROVIDER, useClass: ConsolePushProvider }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
