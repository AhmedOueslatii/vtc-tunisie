export const ACCESS_COOKIE = 'vtc_at';
export const REFRESH_COOKIE = 'vtc_rt';

/** Le cookie d'accès expire un peu avant le jeton : on renouvelle avant que l'API ne le refuse. */
export const ACCESS_MARGIN_S = 30;
const REFRESH_MAX_AGE_S = 30 * 24 * 3600; // aligné sur REFRESH_TTL_DAYS de l'API

export interface Tokens {
  accessToken: string;
  accessTokenExpiresInS: number;
  refreshToken: string;
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

/** Interface commune à `cookies()` (actions, route handlers) et à `response.cookies` (proxy). */
export interface CookieJar {
  set(name: string, value: string, options: CookieOptions): unknown;
}

const base = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' }) as const;

/** Les jetons restent côté serveur (cookies httpOnly) : le JavaScript du navigateur n'y a jamais accès. */
export function setSessionCookies(jar: CookieJar, tokens: Tokens): void {
  jar.set(ACCESS_COOKIE, tokens.accessToken, {
    ...base(),
    maxAge: Math.max(tokens.accessTokenExpiresInS - ACCESS_MARGIN_S, 1),
  });
  jar.set(REFRESH_COOKIE, tokens.refreshToken, { ...base(), maxAge: REFRESH_MAX_AGE_S });
}

export function clearSessionCookies(jar: CookieJar): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) jar.set(name, '', { ...base(), maxAge: 0 });
}

/** En-tête `Cookie` de la requête courante avec les nouveaux jetons, pour que la page rendue voie la session renouvelée. */
export function mergeCookieHeader(existing: { name: string; value: string }[], updates: Record<string, string>): string {
  return [
    ...existing.filter((c) => !(c.name in updates)).map((c) => `${c.name}=${c.value}`),
    ...Object.entries(updates).map(([name, value]) => `${name}=${value}`),
  ].join('; ');
}
