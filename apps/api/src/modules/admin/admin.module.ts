import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { Errors } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import { driverProfiles, users } from '../../db/schema.js';
import { AdminOnly, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { DocumentsService } from '../drivers/documents.service.js';
import { DriversService } from '../drivers/drivers.service.js';
import { NotificationsService } from '../notifications/notifications.module.js';
import { TripsModule } from '../trips/trips.module.js';
import { TripsService } from '../trips/trips.service.js';

const rejectSchema = z.object({ reason: z.string().min(3).max(500) });

/** API du back-office : validation des chauffeurs et de leurs pièces justificatives. */
@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly drivers: DriversService,
    private readonly documents: DocumentsService,
    private readonly trips: TripsService,
    private readonly notifications: NotificationsService,
  ) {}

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

  /** Déclaré après `drivers/pending` : sinon `:id` capturerait « pending ». */
  @Get('drivers/:id')
  async driver(@Param('id', ParseUUIDPipe) id: string) {
    const [detail, documents, missingForApproval] = await Promise.all([
      this.drivers.getAdminDetail(id),
      this.documents.list(id),
      this.documents.missingForApproval(id),
    ]);
    return { ...detail, documents, missingForApproval };
  }

  /** Le fichier ne passe que par cette route authentifiée : pas d'URL publique, pas de cache. */
  @Get('drivers/:id/documents/:docId/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async documentFile(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string) {
    const { data, mime } = await this.documents.read(id, docId);
    return new StreamableFile(data, { type: mime, disposition: 'inline' });
  }

  @Post('drivers/:id/documents/:docId/approve')
  @HttpCode(HttpStatus.OK)
  approveDocument(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    return this.documents.review(admin.id, id, docId, 'approved');
  }

  @Post('drivers/:id/documents/:docId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectDocument(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
  ) {
    const doc = await this.documents.review(admin.id, id, docId, 'rejected', body.reason);
    void this.notifications.notify(id, 'driver.document_rejected', { reason: body.reason }, { documentId: docId });
    return doc;
  }

  /** Trace GPS d'une course, pour trancher un litige (la route passager/chauffeur est `GET /trips/:id/track`). */
  @Get('trips/:id/track')
  track(@Param('id', ParseUUIDPipe) id: string) {
    return this.trips.track(id);
  }

  @Post('drivers/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.documents.assertReadyForApproval(id);
    const [profile] = await this.db
      .update(driverProfiles)
      .set({ status: 'approved', approvedAt: new Date(), approvedBy: admin.id, rejectionReason: null })
      .where(and(eq(driverProfiles.userId, id), inArray(driverProfiles.status, ['pending_documents', 'under_review'])))
      .returning({ userId: driverProfiles.userId, status: driverProfiles.status });
    if (!profile) throw Errors.notFound('Chauffeur en attente');
    void this.notifications.notify(id, 'driver.approved');
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
    void this.notifications.notify(id, 'driver.rejected', { reason: body.reason });
    return profile;
  }
}

@Module({ imports: [DriversModule, TripsModule], controllers: [AdminController] })
export class AdminModule {}
