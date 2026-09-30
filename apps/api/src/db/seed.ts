/**
 * Données de départ : règles tarifaires par défaut + zone aéroport Tunis-Carthage + premier admin.
 * [À VALIDER] Les montants sont des valeurs de travail, à caler sur le marché et les coûts réels.
 */
import { eq, sql } from 'drizzle-orm';
import { env } from '../config/env.js';
import { normalizeTunisianMobile } from '../common/phone.js';
import { createDb } from './db.js';
import { pricingRules, users, zones } from './schema.js';

const { db, pool } = createDb(env().DATABASE_URL);

const defaults = [
  { category: 'standard', baseFare: 1_500, perKm: 700, perMinute: 100, minimumFare: 4_000, cancellationFee: 2_000 },
  { category: 'premium', baseFare: 2_500, perKm: 1_100, perMinute: 150, minimumFare: 7_000, cancellationFee: 3_000 },
  { category: 'van', baseFare: 3_000, perKm: 1_300, perMinute: 150, minimumFare: 9_000, cancellationFee: 3_000 },
] as const;

const existing = await db.select({ id: pricingRules.id }).from(pricingRules).limit(1);
if (existing.length === 0) {
  await db
    .insert(pricingRules)
    .values(defaults.map((d) => ({ ...d, bookingFee: 0, commissionBps: 2_000 })));

  // Emprise approximative de l'aéroport Tunis-Carthage — à redessiner précisément dans le back-office.
  const airport = {
    type: 'MultiPolygon',
    coordinates: [[[[10.2050, 36.8390], [10.2400, 36.8390], [10.2400, 36.8650], [10.2050, 36.8650], [10.2050, 36.8390]]]],
  };
  const [zone] = await db
    .insert(zones)
    .values({ name: 'Aéroport Tunis-Carthage', kind: 'airport', area: sql`ST_GeomFromGeoJSON(${JSON.stringify(airport)})::geography` as unknown as string })
    .returning({ id: zones.id });
  await db.insert(pricingRules).values({
    zoneId: zone!.id,
    category: 'standard',
    baseFare: 3_000,
    perKm: 700,
    perMinute: 100,
    minimumFare: 8_000,
    bookingFee: 0,
    cancellationFee: 2_000,
    commissionBps: 2_000,
  });
  console.log('Règles tarifaires et zone aéroport créées');
}

const adminPhone = process.env.ADMIN_PHONE && normalizeTunisianMobile(process.env.ADMIN_PHONE);
if (adminPhone) {
  await db.insert(users).values({ phone: adminPhone, isAdmin: true }).onConflictDoNothing();
  await db.update(users).set({ isAdmin: true }).where(eq(users.phone, adminPhone));
  console.log(`Admin : ${adminPhone}`);
}

await pool.end();
