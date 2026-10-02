'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { parseDinars, parsePercent } from '@/lib/money';
import { UUID } from '@/lib/types';

const DINAR_FIELDS = ['baseFare', 'perKm', 'perMinute', 'minimumFare', 'bookingFee', 'cancellationFee'] as const;

/**
 * Enregistre une règle tarifaire : l'admin tape des dinars et un pourcentage, l'API reçoit des millimes et des points
 * de base. Une valeur illisible n'est jamais envoyée (pas de « 0 » silencieux) : retour au formulaire avec l'erreur.
 */
export async function updatePricingAction(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  let error: string | undefined;

  const body: Record<string, number | boolean> = {};
  for (const field of DINAR_FIELDS) {
    const millimes = parseDinars(String(formData.get(field) ?? ''));
    if (millimes === null) error = 'VALIDATION_FAILED';
    else body[field] = millimes;
  }
  const commission = parsePercent(String(formData.get('commissionBps') ?? ''));
  if (commission === null) error = 'VALIDATION_FAILED';
  else body.commissionBps = commission;
  // La case « active » n'existe que pour les règles de zone : une case décochée n'envoie rien, d'où le champ témoin
  if (formData.get('hasActiveToggle') === '1') body.isActive = formData.get('isActive') === 'on';

  if (!UUID.test(id)) error = 'VALIDATION_FAILED';
  if (!error) {
    try {
      await api(`/admin/pricing/rules/${id}`, { method: 'PATCH', body });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      error = e.code ?? 'UNKNOWN';
    }
  }
  revalidatePath('/pricing');
  redirect(`/pricing?${error ? `error=${encodeURIComponent(error)}` : 'notice=pricing_updated'}`);
}
