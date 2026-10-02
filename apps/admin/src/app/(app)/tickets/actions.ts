'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { TICKET_STATUSES, type TicketStatus, UUID } from '@/lib/types';

export async function updateTicketAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '') as TicketStatus;
  const returnTo = String(formData.get('returnTo') ?? '');
  // Redirection uniquement vers une page de la liste : jamais d'URL externe fournie par le formulaire
  const back = returnTo.startsWith('/tickets') && !returnTo.startsWith('//') ? returnTo : '/tickets';
  const separator = back.includes('?') ? '&' : '?';

  let error: string | undefined;
  if (!UUID.test(id) || !TICKET_STATUSES.includes(status)) {
    error = 'VALIDATION_FAILED';
  } else {
    try {
      await api(`/admin/tickets/${id}`, { method: 'PATCH', body: { status } });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      error = e.code ?? 'UNKNOWN';
    }
  }
  revalidatePath('/tickets');
  redirect(`${back}${separator}${error ? `error=${encodeURIComponent(error)}` : 'notice=ticket_updated'}`);
}
