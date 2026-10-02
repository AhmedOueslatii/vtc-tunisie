import { NextResponse } from 'next/server';
import { apiUrl } from '@/lib/auth';

/** Demande de code : transmis tel quel à l'API, qui applique ses limites (60 s entre deux envois, 5 par heure). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: unknown } | null;
  if (typeof body?.phone !== 'string') return NextResponse.json({ code: 'VALIDATION_FAILED' }, { status: 400 });

  try {
    const res = await fetch(`${apiUrl()}/auth/otp/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: body.phone }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as { code?: string };
    return NextResponse.json(res.ok ? { ok: true } : { code: data.code ?? 'UNKNOWN' }, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ code: 'NETWORK' }, { status: 503 });
  }
}
