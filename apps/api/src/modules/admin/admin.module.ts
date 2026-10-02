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
import { ApiBody } from '@nestjs/swagger';
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
import { AuditService } from '../audit/audit.module.js';
import { NotificationsService } from '../notifications/notifications.module.js';
import { TripsModule } from '../trips/trips.module.js';
import { TripsService } from '../trips/trips.service.js';
import { AdminExportsController } from './admin-exports.controller.js';
import { AdminPricingController } from './admin-pricing.controller.js';
import { AdminStatsController } from './admin-stats.controller.js';
import { AdminTripsController } from './admin-trips.controller.js';
import { AdminUsersController, AdminUsersService } from './admin-users.controller.js';

const rejectSchema = z.object({ reason: z.string().min(3).max(500) });
const linksSchema = z.object({ documentIds: z.array(z.uuid()).min(1).max(20).optional() });

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
    private readonly audit: AuditService,
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

  /**
   * Liens signés et temporaires vers les scans (tous, ou ceux de `documentIds`). Consulter des pièces d'identité est
   * une opération sensible : chaque émission est journalisée.
   */
  @Post('drivers/:id/documents/links')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ required: false, schema: { type: 'object', properties: { documentIds: { type: 'array', items: { type: 'string', format: 'uuid' } } } } })
  async documentLinks(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(linksSchema)) body: z.infer<typeof linksSchema>,
  ) {
    const result = await this.documents.issueLinks(admin.id, id, body.documentIds);
    void this.audit.recordSafe(admin.id, {
      action: 'document.view',
      entity: 'driver',
      entityId: id,
      details: { documentIds: Object.keys(result.links) },
    });
    return result;
  }

  @Post('drivers/:id/documents/:docId/approve')
  @HttpCode(HttpStatus.OK)
  async approveDocument(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
  ) {
    const doc = await this.documents.review(admin.id, id, docId, 'approved');
    void this.audit.recordSafe(admin.id, { action: 'document.approve', entity: 'document', entityId: docId, details: { driverId: id, type: doc.type } });
    return doc;
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
    void this.audit.recordSafe(admin.id, {
      action: 'document.reject',
      entity: 'document',
      entityId: docId,
      details: { driverId: id, type: doc.type, reason: body.reason },
    });
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
    void this.audit.recordSafe(admin.id, { action: 'driver.approve', entity: 'driver', entityId: id });
    return profile;
  }

  @Post('drivers/:id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
  ) {
    const [profile] = await this.db
      .update(driverProfiles)
      .set({ status: 'rejected', rejectionReason: body.reason })
      .where(eq(driverProfiles.userId, id))
      .returning({ userId: driverProfiles.userId, status: driverProfiles.status });
    if (!profile) throw Errors.notFound('Chauffeur');
    void this.notifications.notify(id, 'driver.rejected', { reason: body.reason });
    void this.audit.recordSafe(admin.id, { action: 'driver.reject', entity: 'driver', entityId: id, details: { reason: body.reason } });
    return profile;
  }
}

@Module({
  imports: [DriversModule, TripsModule],
  controllers: [AdminController, AdminPricingController, AdminTripsController, AdminStatsController, AdminUsersController, AdminExportsController],
  providers: [AdminUsersService],
})
export class AdminModule {}
