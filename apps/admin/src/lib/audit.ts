import { formatDt, formatPercent } from './format';
import { createT, type Locale, labelOf } from './intl';

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const PRICING_FIELDS = ['baseFare', 'perKm', 'perMinute', 'minimumFare', 'bookingFee', 'cancellationFee', 'commissionBps', 'isActive'];

/** « Prise en charge (DT) » → « Prise en charge » : l'unité est dans la valeur affichée. */
const bare = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, '');

function pricingValue(field: string, value: unknown, locale: Locale): string {
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value !== 'number') return String(value);
  return field === 'commissionBps' ? formatPercent(value / 10_000, locale, 2) : formatDt(value, locale);
}

/**
 * Résumé lisible du détail d'une entrée du journal. Le détail est du JSON libre côté base : on ne fait confiance
 * à aucune forme et on retombe sur une chaîne vide plutôt que de planter ou d'afficher un objet brut.
 */
export function describeAudit(action: string, details: unknown, locale: Locale): string {
  if (!isRecord(details)) return '';

  if (action === 'pricing.update' && isRecord(details.before) && isRecord(details.after)) {
    const { before, after } = details;
    const category = typeof details.category === 'string' ? labelOf(locale, 'vehicleCategory', details.category) : '';
    const changes = PRICING_FIELDS.filter((field) => field in after).map(
      (field) =>
        `${bare(labelOf(locale, 'pricing.field', field))} : ${pricingValue(field, before[field], locale)} → ${pricingValue(field, after[field], locale)}`,
    );
    return [category, ...changes].filter(Boolean).join(' · ');
  }
  if ((action === 'wallet.settlement' || action === 'wallet.adjustment') && typeof details.amount === 'number') {
    const amount = `${details.amount > 0 && action === 'wallet.adjustment' ? '+' : ''}${formatDt(details.amount, locale)}`;
    const why = typeof details.reason === 'string' ? details.reason : typeof details.note === 'string' ? details.note : '';
    return [amount, why].filter(Boolean).join(' — ');
  }
  if (action.startsWith('export.') && typeof details.from === 'string' && typeof details.to === 'string') {
    return createT(locale)('audit.exportRows', { from: details.from, to: details.to, rows: typeof details.rows === 'number' ? details.rows : 0 });
  }
  if (action === 'user.reactivate') {
    return typeof details.previousReason === 'string' ? createT(locale)('audit.suspendedFor', { reason: details.previousReason }) : '';
  }
  if (action === 'ticket.update' && typeof details.status === 'string') return labelOf(locale, 'ticketStatus', details.status);
  const type = typeof details.type === 'string' ? labelOf(locale, 'docType', details.type) : '';
  const reason = typeof details.reason === 'string' ? details.reason : '';
  return [type, reason].filter(Boolean).join(' — ');
}
