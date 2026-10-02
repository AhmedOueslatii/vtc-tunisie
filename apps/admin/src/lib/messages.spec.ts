import { describe, expect, it } from 'vitest';
import { ar, fr, type MessageKey } from './messages';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const keys = Object.keys(fr) as MessageKey[];

describe('messages fr / ar', () => {
  it('ont exactement les mêmes clés', () => {
    expect(Object.keys(ar).sort()).toEqual([...keys].sort());
  });

  it.each(keys)('%s : texte non vide et mêmes {variables} dans les deux langues', (key) => {
    expect(fr[key].trim()).not.toBe('');
    expect(ar[key].trim()).not.toBe('');
    expect(placeholders(ar[key])).toEqual(placeholders(fr[key]));
  });

  it("couvrent les codes d'erreur de l'API que l'interface sait afficher", () => {
    const codes = [
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'DOCUMENTS_INCOMPLETE',
      'DOCUMENT_ALREADY_REVIEWED',
      'OTP_EXPIRED',
      'OTP_INVALID',
      'OTP_TOO_SOON',
    ];
    for (const code of codes) expect(`errors.${code}` in fr, code).toBe(true);
  });

  it('couvrent chaque statut, type de document et catégorie connus', () => {
    const expected = [
      ...['pending_documents', 'under_review', 'approved', 'rejected', 'suspended'].map((s) => `driverStatus.${s}`),
      ...['pending', 'approved', 'rejected', 'expired'].map((s) => `docStatus.${s}`),
      ...['cin', 'driving_license', 'vehicle_registration', 'insurance', 'criminal_record', 'profile_photo'].map(
        (s) => `docType.${s}`,
      ),
      ...['open', 'in_progress', 'resolved', 'closed'].map((s) => `ticketStatus.${s}`),
      ...['incident', 'lost_item', 'payment', 'safety', 'other'].map((s) => `ticketCategory.${s}`),
    ];
    for (const key of expected) expect(key in fr, key).toBe(true);
  });
});
