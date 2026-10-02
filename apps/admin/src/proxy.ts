import { type NextRequest, NextResponse } from 'next/server';
import { refreshTokens } from './lib/auth';
import {
  ACCESS_COOKIE,
  clearSessionCookies,
  mergeCookieHeader,
  REFRESH_COOKIE,
  setSessionCookies,
  type Tokens,
} from './lib/session';

/**
 * Garde d'accès + renouvellement de session. Le cookie d'accès expire avant le jeton (15 min) : s'il manque et
 * qu'un refresh token est présent, on en obtient un nouveau ici, avant le rendu de la page. L'API reste l'autorité :
 * chaque appel est de toute façon refusé sans jeton admin valide, ce proxy ne sert qu'à rediriger proprement.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;

  let renewed: Tokens | undefined;
  let sessionEnded = false;
  if (!access && refresh) {
    const result = await refreshTokens(refresh);
    if (result.kind === 'ok') {
      renewed = result.tokens;
      access = renewed.accessToken;
    } else {
      sessionEnded = result.kind === 'invalid';
    }
  }

  const authenticated = Boolean(access);
  const isPublic = pathname === '/login' || pathname.startsWith('/api/auth/');

  let response: NextResponse;
  if (!authenticated && !isPublic) {
    response = pathname.startsWith('/api/')
      ? NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', request.url));
  } else if (authenticated && pathname === '/login') {
    response = NextResponse.redirect(new URL('/', request.url));
  } else if (renewed) {
    const headers = new Headers(request.headers);
    headers.set(
      'cookie',
      mergeCookieHeader(request.cookies.getAll(), {
        [ACCESS_COOKIE]: renewed.accessToken,
        [REFRESH_COOKIE]: renewed.refreshToken,
      }),
    );
    response = NextResponse.next({ request: { headers } });
  } else {
    response = NextResponse.next();
  }

  if (renewed) setSessionCookies(response.cookies, renewed);
  if (sessionEnded) clearSessionCookies(response.cookies);
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
