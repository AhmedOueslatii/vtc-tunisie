import { NextResponse } from 'next/server';
import { apiRaw } from '@/lib/api';

const FILES: Record<string, string> = { trips: 'trips.csv', 'driver-earnings': 'driver-earnings.csv' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Téléchargement d'un export comptable. Le navigateur ne détient pas le jeton admin (cookie httpOnly, en-tête
 * Authorization attendu par l'API) : ce serveur relaie. Le fichier est lu en entier avant de répondre.
 */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const file = FILES[kind];
  if (!file) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const back = (code: string) => NextResponse.redirect(new URL(`/exports?error=${encodeURIComponent(code)}`, request.url));
  if (!DATE.test(from) || !DATE.test(to)) return back('VALIDATION_FAILED');

  const res = await apiRaw(`/admin/exports/${file}`, { query: { from, to } });
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { code?: string };
    return back(error.code ?? 'UNKNOWN');
  }

  const content = await res.arrayBuffer();
  return new NextResponse(content, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': res.headers.get('content-disposition') ?? `attachment; filename="${file}"`,
      'cache-control': 'private, no-store',
    },
  });
}
