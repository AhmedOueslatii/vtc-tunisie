import { cookies } from 'next/headers';
import { createT, DEFAULT_LOCALE, isLocale, LANG_COOKIE, type Locale, type Translate } from './intl';

/** Langue de la requête (cookie), côté serveur uniquement. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getT(): Promise<{ locale: Locale; t: Translate }> {
  const locale = await getLocale();
  return { locale, t: createT(locale) };
}
