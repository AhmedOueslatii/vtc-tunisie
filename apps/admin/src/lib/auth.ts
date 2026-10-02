import type { Tokens } from './session';

/** URL de l'API vue depuis le serveur Next.js. Jamais envoyée au navigateur. */
export const apiUrl = () => process.env.API_URL ?? 'http://localhost:3000/v1';

/**
 * URL de l'API vue depuis le NAVIGATEUR de l'admin : les scans de documents s'y chargent directement par lien signé.
 * Peut différer de `API_URL` (adresse interne entre serveurs) ; par défaut la même.
 */
export const apiPublicUrl = () => process.env.API_PUBLIC_URL ?? apiUrl();

export type RefreshResult =
  | { kind: 'ok'; tokens: Tokens }
  | { kind: 'invalid' } // refresh token refusé : la session est terminée
  | { kind: 'unavailable' }; // API injoignable : on garde la session et on réessaiera

export async function refreshTokens(refreshToken: string): Promise<RefreshResult> {
  try {
    const res = await fetch(`${apiUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 401 || res.status === 400) return { kind: 'invalid' };
    if (!res.ok) return { kind: 'unavailable' };
    return { kind: 'ok', tokens: (await res.json()) as Tokens };
  } catch {
    return { kind: 'unavailable' };
  }
}
