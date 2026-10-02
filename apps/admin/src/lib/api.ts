import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiUrl } from './auth';
import { ACCESS_COOKIE } from './session';

/** Erreur renvoyée par l'API : `code` est stable (voir `errors.*` dans messages.ts), `message` est pour les logs. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | undefined>;
}

/** Appel authentifié de l'API depuis un composant serveur ou une action. Sans session valide : retour à la connexion. */
export async function apiRaw(path: string, { method = 'GET', body, query }: Options = {}): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/login');

  const search = new URLSearchParams(Object.entries(query ?? {}).filter((e): e is [string, string] => e[1] !== undefined));
  const send = () =>
    fetch(`${apiUrl()}${path}${search.size ? `?${search}` : ''}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });

  let res: Response;
  try {
    try {
      res = await send();
    } catch (e) {
      // Une connexion réutilisée peut avoir été fermée par l'API entre deux requêtes : on rejoue une fois les lectures,
      // jamais une écriture (elle a pu être prise en compte). Un délai dépassé n'est pas rejoué : l'admin attendrait 20 s.
      if (method !== 'GET' || (e as Error).name === 'TimeoutError') throw e;
      res = await send();
    }
  } catch (e) {
    // Sans cette trace, un délai dépassé est indiscernable d'une panne : on garde la route concernée
    console.error(`API injoignable : ${method} ${path} — ${(e as Error).message}`);
    throw new ApiError(503, 'NETWORK', (e as Error).message);
  }
  if (res.status === 401) {
    await res.body?.cancel(); // libère la connexion : un corps non lu la garde occupée
    redirect('/login');
  }
  return res;
}

export async function api<T = void>(path: string, options?: Options): Promise<T> {
  const res = await apiRaw(path, options);
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new ApiError(res.status, error.code, error.message ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
