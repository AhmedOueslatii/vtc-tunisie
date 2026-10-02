/** Conversions entre ce que l'admin tape (dinars, pourcentages) et ce que stocke l'API (millimes, points de base). */

/** « 1,5 », « 1.500 » ou « 2 » → millimes entiers ; `null` si ce n'est pas un montant valide (3 décimales maximum). */
export function parseDinars(input: string): number | null {
  const value = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(value)) return null;
  return Math.round(Number.parseFloat(value) * 1000);
}

export const toDinarsInput = (millimes: number): string => (millimes / 1000).toFixed(3);

/** « 20 » ou « 12,5 » (%) → points de base (2000 = 20 %) ; `null` si invalide (2 décimales maximum). */
export function parsePercent(input: string): number | null {
  const value = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number.parseFloat(value) * 100);
}

export const toPercentInput = (bps: number): string => (bps / 100).toFixed(2);

export interface FareRule {
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
  bookingFee: number;
}

/**
 * Prix d'une course type, avec la formule de l'API (`apps/api/src/modules/pricing/fare.ts`) :
 * max(minimum, base + km × tarif + min × tarif) + frais de réservation, arrondi à 100 millimes.
 * Sert d'aperçu à l'admin : à garder identique à l'API.
 */
export function exampleFare(rule: FareRule, km: number, minutes: number): number {
  const metered = rule.baseFare + rule.perKm * km + rule.perMinute * minutes;
  return Math.round((Math.max(rule.minimumFare, metered) + rule.bookingFee) / 100) * 100;
}
