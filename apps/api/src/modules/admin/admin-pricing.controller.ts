import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Errors } from '../../common/errors.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import { pricingRules, zones } from '../../db/schema.js';
import { AdminOnly, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { AuditService } from '../audit/audit.module.js';

/** Montants en millimes (1 DT = 1000 millimes) ; plafond de 1000 DT pour écarter une faute de frappe. */
const amount = z.number().int().min(0).max(1_000_000);

const FIELDS = ['baseFare', 'perKm', 'perMinute', 'minimumFare', 'bookingFee', 'cancellationFee', 'commissionBps', 'isActive'] as const;

const updateSchema = z
  .object({
    baseFare: amount,
    perKm: amount,
    perMinute: amount,
    minimumFare: amount,
    bookingFee: amount,
    cancellationFee: amount,
    commissionBps: z.number().int().min(0).max(5_000), // 5000 = 50 %
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucune modification' });

/**
 * Tarification. Les règles sont lues à chaque devis : une modification s'applique aux nouveaux devis,
 * ceux déjà émis gardent leur prix garanti (`quoteId`).
 */
@AdminOnly()
@Controller('admin/pricing')
export class AdminPricingController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get('rules')
  async rules() {
    const rows = await this.db
      .select({ rule: pricingRules, zone: { id: zones.id, name: zones.name, kind: zones.kind } })
      .from(pricingRules)
      .leftJoin(zones, eq(zones.id, pricingRules.zoneId))
      .orderBy(asc(pricingRules.category), sql`${pricingRules.zoneId} IS NOT NULL`, asc(pricingRules.createdAt));
    return rows.map(({ rule, zone }) => ({ ...rule, zone: zone?.id ? zone : null }));
  }

  @Patch('rules/:id')
  update(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(pricingRules).where(eq(pricingRules.id, id)).for('update');
      if (!before) throw Errors.notFound('Règle tarifaire');
      // Sans règle par défaut active, plus aucun devis n'est possible pour la catégorie
      if (body.isActive === false && before.zoneId === null) {
        throw Errors.conflict('DEFAULT_RULE_REQUIRED', 'La règle par défaut d’une catégorie ne peut pas être désactivée');
      }

      const changed = FIELDS.filter((field) => body[field] !== undefined && body[field] !== before[field]);
      if (changed.length === 0) return before;

      const patch = Object.fromEntries(changed.map((field) => [field, body[field]]));
      const [after] = await tx.update(pricingRules).set(patch).where(eq(pricingRules.id, id)).returning();
      await this.audit.record(
        admin.id,
        {
          action: 'pricing.update',
          entity: 'pricing_rule',
          entityId: id,
          details: {
            category: before.category,
            zoneId: before.zoneId,
            before: Object.fromEntries(changed.map((field) => [field, before[field]])),
            after: patch,
          },
        },
        tx,
      );
      return after;
    });
  }
}
