import { Controller, Get, Global, Inject, Injectable, Logger, Module, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DB, type Db } from '../../db/db.js';
import { adminAuditLog, users } from '../../db/schema.js';
import { AdminOnly } from '../auth/auth.guard.js';

export interface AuditEntry {
  /** ex. `pricing.update`, `driver.approve` */
  action: string;
  /** ex. `pricing_rule`, `driver`, `document`, `ticket` */
  entity: string;
  entityId: string;
  details?: Record<string, unknown>;
}

/** Accepte `db` ou une transaction : une action sensible et sa trace d'audit réussissent ou échouent ensemble. */
export type AuditExecutor = Pick<Db, 'insert'>;

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.coerce.number().int().positive().optional(),
  entity: z.string().trim().min(1).max(40).optional(),
});

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Pour les actions où la trace doit être atomique avec la modification (passer la transaction). */
  async record(adminId: string, entry: AuditEntry, executor: AuditExecutor = this.db): Promise<void> {
    await executor.insert(adminAuditLog).values({ adminId, ...entry });
  }

  /** Pour les actions déjà effectuées : une panne du journal ne doit pas annuler la réponse à l'admin. */
  async recordSafe(adminId: string, entry: AuditEntry): Promise<void> {
    try {
      await this.record(adminId, entry);
    } catch (e) {
      this.logger.error(`journal d'audit (${entry.action} ${entry.entityId}) : ${(e as Error).message}`);
    }
  }

  async list(query: z.infer<typeof listSchema>) {
    const rows = await this.db
      .select({
        entry: adminAuditLog,
        admin: { id: users.id, fullName: users.fullName, phone: users.phone },
      })
      .from(adminAuditLog)
      .innerJoin(users, eq(users.id, adminAuditLog.adminId))
      .where(
        and(
          query.entity ? eq(adminAuditLog.entity, query.entity) : undefined,
          query.cursor ? lt(adminAuditLog.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(adminAuditLog.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page.at(-1)?.entry;
    return {
      items: page.map(({ entry, admin }) => ({ ...entry, admin })),
      nextCursor: rows.length > query.limit && last ? String(last.id) : null,
    };
  }
}

@AdminOnly()
@Controller('admin/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiQuery({ name: 'entity', required: false, description: 'pricing_rule, driver, document, ticket…' })
  @ApiQuery({ name: 'limit', required: false, description: '1 à 100 (défaut 30)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'nextCursor de la page précédente' })
  list(@Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.audit.list(query);
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
