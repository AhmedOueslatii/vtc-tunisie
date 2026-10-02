import { describe, expect, it } from 'vitest';
import { createT, directionOf, errorText, formatDate, interpolate, isLocale, labelOf, labelsFor } from './intl';

describe('intl', () => {
  it('interpole les variables et laisse intactes celles qui manquent', () => {
    expect(interpolate('Bonjour {name}, {n} dossiers', { name: 'Sami', n: 3 })).toBe('Bonjour Sami, 3 dossiers');
    expect(interpolate('Bonjour {name}')).toBe('Bonjour {name}');
  });

  it('traduit dans la langue demandée', () => {
    expect(createT('fr')('nav.drivers')).toBe('Chauffeurs');
    expect(createT('ar')('nav.drivers')).toBe('السائقون');
    expect(createT('fr')('driver.expiresOn', { date: '1 janv.' })).toBe('Expire le 1 janv.');
  });

  it("l'arabe s'écrit de droite à gauche", () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('fr')).toBe('ltr');
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('en')).toBe(false);
  });

  it('affiche la valeur brute pour un statut inconnu plutôt que de planter', () => {
    expect(labelOf('fr', 'driverStatus', 'approved')).toBe('Validé');
    expect(labelOf('fr', 'driverStatus', 'nouveau_statut')).toBe('nouveau_statut');
  });

  it("ne montre jamais le texte brut de l'API : code connu traduit, sinon message générique", () => {
    expect(errorText('fr', 'DOCUMENTS_INCOMPLETE')).toBe('Documents manquants ou non validés.');
    expect(errorText('ar', 'OTP_INVALID')).toBe('الرمز غير صحيح.');
    expect(errorText('fr', 'CODE_QUI_N_EXISTE_PAS')).toBe(errorText('fr', undefined));
    expect(errorText('fr', 'constructor')).toBe(errorText('fr', undefined));
  });

  it('filtre les textes envoyés aux composants client par préfixe', () => {
    const labels = labelsFor('fr', 'auth.', 'errors.');
    expect(Object.keys(labels).every((k) => k.startsWith('auth.') || k.startsWith('errors.'))).toBe(true);
    expect(labels['auth.verify']).toBe('Se connecter');
    expect(labels['nav.drivers']).toBeUndefined();
  });

  it("formate les dates à l'heure de Tunis", () => {
    // 23:30 UTC le 31 décembre = 00:30 le 1er janvier 2027 à Tunis (UTC+1)
    expect(formatDate('2026-12-31T23:30:00Z', 'fr')).toContain('2027');
    expect(formatDate('2026-12-31T23:30:00Z', 'ar')).toContain('2027');
    expect(formatDate('2026-06-15T10:05:00Z', 'fr', true)).toMatch(/11[:\sh]+05/);
  });
});
