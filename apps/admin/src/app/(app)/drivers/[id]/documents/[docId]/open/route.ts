import { NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { apiPublicUrl } from '@/lib/auth';
import { type DocumentLinks, UUID } from '@/lib/types';

/**
 * « Ouvrir dans un nouvel onglet » : émet un lien signé tout neuf puis y redirige. Celui affiché dans la page a une durée
 * de vie courte et peut avoir expiré si la fiche est restée ouverte. La session admin est exigée (proxy + API).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  if (!UUID.test(id) || !UUID.test(docId)) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

  try {
    const { links } = await api<DocumentLinks>(`/admin/drivers/${id}/documents/links`, { method: 'POST', body: { documentIds: [docId] } });
    const path = links[docId];
    if (!path) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.redirect(`${apiPublicUrl()}${path}`);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    return NextResponse.json({ code: e.code ?? 'UNKNOWN' }, { status: e.status });
  }
}
