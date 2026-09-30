import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { AppError } from '../../common/errors.js';
import { type LatLng, toEwktPoint } from '../../common/geo.js';
import { DB, type Db } from '../../db/db.js';
import { pricingRules, zones } from '../../db/schema.js';
import type { VehicleCategory } from '../drivers/presence.service.js';
import { computeFare } from './fare.js';

@Injectable()
export class PricingService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Règle applicable : une règle de zone (aéroport, …) couvrant le départ ou l'arrivée l'emporte
   * sur la règle par défaut de la catégorie.
   */
  async findRule(pickup: LatLng, dropoff: LatLng, category: VehicleCategory) {
    const covers = (p: LatLng) => sql`ST_Covers(${zones.area}, ${toEwktPoint(p)}::geography)`;
    const [row] = await this.db
      .select({ rule: pricingRules })
      .from(pricingRules)
      .leftJoin(zones, eq(zones.id, pricingRules.zoneId))
      .where(
        and(
          eq(pricingRules.category, category),
          eq(pricingRules.isActive, true),
          or(isNull(pricingRules.zoneId), and(eq(zones.isActive, true), or(covers(pickup), covers(dropoff)))),
        ),
      )
      .orderBy(sql`${pricingRules.zoneId} IS NULL`)
      .limit(1);
    if (!row) throw new AppError('CATEGORY_UNAVAILABLE', `Aucune tarification pour la catégorie ${category}`);
    return row.rule;
  }

  /** Point d'extension pour la tarification dynamique (phase 2) : demande / offre par zone et heure. */
  async surgeMultiplier(_pickup: LatLng, _category: VehicleCategory): Promise<number> {
    return 1;
  }

  async quote(pickup: LatLng, dropoff: LatLng, category: VehicleCategory, distanceM: number, durationS: number) {
    const rule = await this.findRule(pickup, dropoff, category);
    const surge = await this.surgeMultiplier(pickup, category);
    return { rule, surge, price: computeFare(rule, distanceM, durationS, surge) };
  }
}
