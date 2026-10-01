import { Body, Controller, Get, HttpStatus, Inject, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError, Errors } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import { supportTickets, trips, users } from '../../db/schema.js';
import { AdminOnly, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { NotificationsService } from '../notifications/notifications.module.js';

const CATEGORIES = ['incident', 'lost_item', 'payment', 'safety', 'other'] as const;
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
const MAX_OPEN_PER_USER = 10;

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().trim().min(5).max(2000),
  tripId: z.uuid().optional(),
});
const updateSchema = z.object({ status: z.enum(STATUSES) });
const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.date().optional(),
  status: z.enum(STATUSES).optional(),
});

@Injectable()
export class SupportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notifications: NotificationsService,
  ) {}

  /** Signalement d'incident (ou autre demande) par un passager ou un chauffeur, éventuellement rattaché à une de ses courses. */
  async create(userId: string, input: z.infer<typeof createSchema>) {
    if (input.tripId) {
      const [trip] = await this.db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, input.tripId), or(eq(trips.passengerId, userId), eq(trips.driverId, userId))));
      if (!trip) throw Errors.notFound('Course');
    }
    const [{ count } = { count: 0 }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(supportTickets)
      .where(and(eq(supportTickets.reporterId, userId), inArray(supportTickets.status, ['open', 'in_progress'])));
    if (count >= MAX_OPEN_PER_USER) {
      throw new AppError('TOO_MANY_OPEN_TICKETS', 'Trop de signalements en cours', HttpStatus.TOO_MANY_REQUESTS);
    }

    const [ticket] = await this.db
      .insert(supportTickets)
      .values({ reporterId: userId, tripId: input.tripId, category: input.category, description: input.description })
      .returning();
    return ticket;
  }

  mine(userId: string) {
    return this.db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.reporterId, userId))
      .orderBy(desc(supportTickets.createdAt))
      .limit(50);
  }

  async list(query: z.infer<typeof listSchema>) {
    const rows = await this.db
      .select({
        ticket: supportTickets,
        reporter: { id: users.id, phone: users.phone, fullName: users.fullName },
        tripStatus: trips.status,
      })
      .from(supportTickets)
      .innerJoin(users, eq(users.id, supportTickets.reporterId))
      .leftJoin(trips, eq(trips.id, supportTickets.tripId))
      .where(
        and(
          query.status ? eq(supportTickets.status, query.status) : undefined,
          // Postgres stocke des microsecondes, le curseur JS des millisecondes : on compare à la milliseconde.
          query.cursor ? sql`date_trunc('milliseconds', ${supportTickets.createdAt}) < ${query.cursor}` : undefined,
        ),
      )
      .orderBy(desc(supportTickets.createdAt))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1)?.ticket;
    return {
      items: page.map(({ ticket, reporter, tripStatus }) => ({ ...ticket, reporter, tripStatus })),
      nextCursor: rows.length > query.limit && last ? last.createdAt.toISOString() : null,
    };
  }

  /** Le premier admin qui prend le ticket en charge lui est assigné. */
  async update(adminId: string, ticketId: string, status: (typeof STATUSES)[number]) {
    const [ticket] = await this.db
      .update(supportTickets)
      .set({
        status,
        assignedTo: sql`CASE WHEN ${status} = 'in_progress' THEN COALESCE(${supportTickets.assignedTo}, ${adminId}::uuid) ELSE ${supportTickets.assignedTo} END`,
      })
      .where(eq(supportTickets.id, ticketId))
      .returning();
    if (!ticket) throw Errors.notFound('Ticket');
    void this.notifications.notify(ticket.reporterId, 'support.ticket_updated', { status }, { ticketId: ticket.id });
    return ticket;
  }
}

@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    return this.support.create(user.id, body);
  }

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.support.mine(user.id);
  }
}

@AdminOnly()
@Controller('admin/tickets')
export class AdminTicketsController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'limit', required: false, description: '1 à 50 (défaut 20)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor de la page précédente' })
  list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.support.list(query);
  }

  @Patch(':id')
  update(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.support.update(admin.id, id, body.status);
  }
}

@Module({ controllers: [SupportController, AdminTicketsController], providers: [SupportService] })
export class SupportModule {}
