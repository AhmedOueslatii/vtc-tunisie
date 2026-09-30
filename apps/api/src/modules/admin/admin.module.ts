import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { Errors } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import { driverProfiles, users } from '../../db/schema.js';
import { AdminOnly, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/tokens.service.js';

const rejectSchema = z.object({ reason: z.string().min(3).max(500) });

/** API minimale du back-office en phase 1 : validation des chauffeurs. */
@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('drivers/pending')
  pending() {
    return this.db
      .select({
        userId: driverProfiles.userId,
        status: driverProfiles.status,
        licenseExpiry: driverProfiles.licenseExpiry,
        createdAt: driverProfiles.createdAt,
        phone: users.phone,
        fullName: users.fullName,
      })
      .from(driverProfiles)
      .innerJoin(users, eq(users.id, driverProfiles.userId))
      .where(inArray(driverProfiles.status, ['pending_documents', 'under_review']));
  }

  @Post('drivers/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const [profile] = await this.db
      .update(driverProfiles)
      .set({ status: 'approved', approvedAt: new Date(), approvedBy: admin.id, rejectionReason: null })
      .where(and(eq(driverProfiles.userId, id), inArray(driverProfiles.status, ['pending_documents', 'under_review'])))
      .returning({ userId: driverProfiles.userId, status: driverProfiles.status });
    if (!profile) throw Errors.notFound('Chauffeur en attente');
    return profile;
  }

  @Post('drivers/:id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>) {
    const [profile] = await this.db
      .update(driverProfiles)
      .set({ status: 'rejected', rejectionReason: body.reason })
      .where(eq(driverProfiles.userId, id))
      .returning({ userId: driverProfiles.userId, status: driverProfiles.status });
    if (!profile) throw Errors.notFound('Chauffeur');
    return profile;
  }
}

@Module({ controllers: [AdminController] })
export class AdminModule {}
