/** Tous les montants en millimes (1 TND = 1000 millimes). */
export interface FareRule {
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
  bookingFee: number;
}

/** Arrondi à 100 millimes : pas de monnaie plus fine en pratique pour un paiement cash. */
export const CASH_ROUNDING = 100;

/**
 * prix = max(minimum, (base + km × tarif_km + min × tarif_min) × surge) + frais de réservation,
 * arrondi au multiple de 100 millimes le plus proche.
 */
export function computeFare(rule: FareRule, distanceM: number, durationS: number, surge = 1): number {
  const metered = rule.baseFare + (rule.perKm * distanceM) / 1000 + (rule.perMinute * durationS) / 60;
  const fare = Math.max(rule.minimumFare, metered * surge) + rule.bookingFee;
  return Math.round(fare / CASH_ROUNDING) * CASH_ROUNDING;
}

export function formatTnd(millimes: number): string {
  return `${(millimes / 1000).toFixed(3)} TND`;
}
