import { type MessageKey, messages } from './messages';

/** Partie « pure » de l'internationalisation : utilisable côté serveur comme dans les composants client. */

export const LOCALES = ['fr', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';
export const LANG_COOKIE = 'vtc_lang';

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);
export const directionOf = (locale: Locale) => (locale === 'ar' ? 'rtl' : 'ltr');

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function interpolate(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function createT(locale: Locale): Translate {
  return (key, vars) => interpolate(messages[locale][key], vars);
}

/** Clé dynamique (`driverStatus.${status}`) : si elle n'existe pas, on affiche la valeur brute plutôt que de planter. */
export function labelOf(locale: Locale, prefix: string, value: string): string {
  const key = `${prefix}.${value}`;
  return key in messages[locale] ? messages[locale][key as MessageKey] : value;
}

/** Message affichable pour un code d'erreur de l'API (jamais le texte renvoyé par l'API). */
export function errorText(locale: Locale, code: string | undefined): string {
  const key = `errors.${code}`;
  return messages[locale][(key in messages[locale] ? key : 'errors.UNKNOWN') as MessageKey];
}

/** Sous-ensemble de textes à passer à un composant client (par préfixe de clé). */
export function labelsFor(locale: Locale, ...prefixes: string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(messages[locale]).filter(([key]) => prefixes.some((p) => key.startsWith(p))));
}

/** Dates affichées selon la langue ; chiffres latins dans les deux cas (usage courant en Tunisie). */
export function formatDate(value: string | Date, locale: Locale, withTime = false): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-TN-u-nu-latn' : 'fr-TN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Africa/Tunis',
  }).format(date);
}
