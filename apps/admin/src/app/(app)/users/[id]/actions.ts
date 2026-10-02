'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { UUID } from '@/lib/types';

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

async function finish(userId: string, attempt: () => Promise<unknown>, notice: string): Promise<never> {
  let error: string | undefined;
  try {
    await attempt();
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.code ?? 'UNKNOWN';
  }
  revalidatePath(`/users/${userId}`);
  revalidatePath('/users');
  redirect(`/users/${userId}?${error ? `error=${encodeURIComponent(error)}` : `notice=${notice}`}`);
}

/** Suspension : le motif est obligatoire (validé par l'API) ; l'API refuse pendant une course, pour un admin et pour soi-même. */
export async function suspendAction(formData: FormData) {
  const userId = text(formData, 'userId');
  if (!UUID.test(userId)) notFound();
  await finish(userId, () => api(`/admin/users/${userId}/suspend`, { method: 'POST', body: { reason: text(formData, 'reason') } }), 'user_suspended');
}

export async function reactivateAction(formData: FormData) {
  const userId = text(formData, 'userId');
  if (!UUID.test(userId)) notFound();
  await finish(userId, () => api(`/admin/users/${userId}/reactivate`, { method: 'POST' }), 'user_reactivated');
}
