'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { UUID } from '@/lib/types';

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

/** Exécute l'appel puis revient sur la fiche avec un message de succès ou le code d'erreur de l'API. */
async function finish(driverId: string, attempt: () => Promise<unknown>, notice: string): Promise<never> {
  let error: string | undefined;
  try {
    await attempt();
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }
  revalidatePath(`/drivers/${driverId}`);
  revalidatePath('/drivers');
  redirect(`/drivers/${driverId}?${error ? `error=${encodeURIComponent(error)}` : `notice=${notice}`}`);
}

/** Approuve ou refuse une pièce. Le refus exige un motif (validé par l'API) et renvoie le dossier au chauffeur. */
export async function reviewDocumentAction(formData: FormData) {
  const driverId = text(formData, 'driverId');
  const docId = text(formData, 'docId');
  if (!UUID.test(driverId) || !UUID.test(docId)) notFound();

  if (text(formData, 'decision') === 'approve') {
    await finish(driverId, () => api(`/admin/drivers/${driverId}/documents/${docId}/approve`, { method: 'POST' }), 'doc_approved');
  }
  await finish(
    driverId,
    () => api(`/admin/drivers/${driverId}/documents/${docId}/reject`, { method: 'POST', body: { reason: text(formData, 'reason') } }),
    'doc_rejected',
  );
}

/** Valide ou refuse le dossier. L'API refuse la validation tant que les pièces obligatoires ne sont pas approuvées. */
export async function decideDriverAction(formData: FormData) {
  const driverId = text(formData, 'driverId');
  if (!UUID.test(driverId)) notFound();

  if (text(formData, 'decision') === 'approve') {
    await finish(driverId, () => api(`/admin/drivers/${driverId}/approve`, { method: 'POST' }), 'driver_approved');
  }
  await finish(
    driverId,
    () => api(`/admin/drivers/${driverId}/reject`, { method: 'POST', body: { reason: text(formData, 'reason') } }),
    'driver_rejected',
  );
}
