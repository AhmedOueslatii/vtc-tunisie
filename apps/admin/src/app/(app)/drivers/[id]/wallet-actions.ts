'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { parseDinars, parseSignedDinars } from '@/lib/money';
import { UUID } from '@/lib/types';

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

async function finish(driverId: string, attempt: () => Promise<unknown>, notice: string): Promise<never> {
  let error: string | undefined;
  try {
    await attempt();
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }
  revalidatePath(`/drivers/${driverId}`);
  revalidatePath('/wallets');
  redirect(`/drivers/${driverId}?${error ? `error=${encodeURIComponent(error)}` : `notice=${notice}`}`);
}

/** Le chauffeur a remis de l'argent à la plateforme. Un montant illisible n'est jamais envoyé (pas de « 0 » silencieux). */
export async function settleAction(formData: FormData) {
  const driverId = text(formData, 'driverId');
  if (!UUID.test(driverId)) notFound();
  const amount = parseDinars(text(formData, 'amount'));
  const note = text(formData, 'note');

  await finish(
    driverId,
    async () => {
      if (amount === null || amount === 0) throw new ApiError(400, 'VALIDATION_FAILED', 'montant invalide');
      await api(`/admin/drivers/${driverId}/wallet/settlements`, { method: 'POST', body: { amount, ...(note ? { note } : {}) } });
    },
    'wallet_settled',
  );
}

/** Correction manuelle, signée (« -5 » = le chauffeur doit 5 DT de plus) et motivée. */
export async function adjustAction(formData: FormData) {
  const driverId = text(formData, 'driverId');
  if (!UUID.test(driverId)) notFound();
  const amount = parseSignedDinars(text(formData, 'amount'));
  const reason = text(formData, 'reason');

  await finish(
    driverId,
    async () => {
      if (amount === null || amount === 0) throw new ApiError(400, 'VALIDATION_FAILED', 'montant invalide');
      await api(`/admin/drivers/${driverId}/wallet/adjustments`, { method: 'POST', body: { amount, reason } });
    },
    'wallet_adjusted',
  );
}
