import type { Locale } from './intl';

/**
 * Formats d'affichage (nombres, dinars, pourcentages). Chiffres latins, espace pour les milliers et virgule décimale
 * dans les DEUX langues : c'est l'usage courant en Tunisie. Le format arabe par défaut (« 3.000 ») écrit le séparateur de
 * milliers avec un point, et se lit alors comme 3 dinars au lieu de 3 000.
 */

export function formatNumber(value: number, _locale: Locale, fractionDigits = 0): string {
  return new Intl.NumberFormat('fr-TN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** Montant en millimes (1 DT = 1000 millimes) affiché en dinars, avec 3 décimales comme la monnaie tunisienne. */
export function formatDt(millimes: number, locale: Locale, fractionDigits = 3): string {
  return `${formatNumber(millimes / 1000, locale, fractionDigits)} ${locale === 'ar' ? 'د.ت' : 'DT'}`;
}

export function formatPercent(ratio: number, locale: Locale, fractionDigits = 0): string {
  return `${formatNumber(ratio * 100, locale, fractionDigits)} %`;
}

export function formatKm(meters: number, locale: Locale): string {
  return `${formatNumber(meters / 1000, locale, 1)} ${locale === 'ar' ? 'كم' : 'km'}`;
}
