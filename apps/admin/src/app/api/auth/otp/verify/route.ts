import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiUrl } from '@/lib/auth';
import { setSessionCookies, type Tokens } from '@/lib/session';

interface VerifyResponse extends Tokens {
  user: { isAdmin: boolean };
}

/**
 * Vérifie le code et ouvre la session. Un compte sans droits admin est refusé ici (sinon il aurait
 * une session inutilisable) et la session que l'API vient de créer est aussitôt révoquée.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: unknown; code?: unknown } | null;
  if (typeof body?.phone !== 'string' || typeof body.code !== 'string') {
    return NextResponse.json({ code: 'VALIDATION_FAILED' }, { status: 400 });
  }

  try {
    const res = await fetch(`${apiUrl()}/auth/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': request.headers.get('user-agent') ?? 'vtc-admin' },
      body: JSON.stringify({ phone: body.phone, code: body.code }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { code?: string };
      return NextResponse.json({ code: data.code ?? 'UNKNOWN' }, { status: res.status });
    }

    const session = (await res.json()) as VerifyResponse;
    if (!session.user.isAdmin) {
      await fetch(`${apiUrl()}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }).catch(() => undefined);
      return NextResponse.json({ code: 'NOT_ADMIN' }, { status: 403 });
    }

    setSessionCookies(await cookies(), session);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ code: 'NETWORK' }, { status: 503 });
  }
}
