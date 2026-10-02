import { describe, expect, it } from 'vitest';
import { describeAudit } from './audit';
import { labelIndices, niceScale } from './chart';
import { formatDt, formatKm, formatNumber, formatPercent } from './format';
import { exampleFare, parseDinars, parsePercent, parseSignedDinars, toDinarsInput, toPercentInput } from './money';

describe('format', () => {
  it('affiche les millimes en dinars avec 3 décimales', () => {
    expect(formatDt(12_300, 'fr').replace(/\s/g, ' ')).toBe('12,300 DT');
    expect(formatDt(12_300, 'ar')).toContain('د.ت');
    // Même format des nombres dans les deux langues : « 3.000 » en arabe se lirait 3 dinars, pas 3 000
    const spaces = (text: string) => text.replace(/[\s  ]/g, '');
    expect(spaces(formatNumber(3_000, 'ar'))).toBe('3000');
    expect(formatNumber(3_000, 'ar')).toBe(formatNumber(3_000, 'fr'));
    expect(spaces(formatDt(2_225_600, 'ar'))).toBe('2225,600د.ت');
    expect(formatNumber(2_161.4, 'ar', 1)).toBe(formatNumber(2_161.4, 'fr', 1));
    expect(formatDt(1_250_000, 'fr').replace(/[\s  ]/g, '')).toBe('1250,000DT');
  });

  it('formate pourcentages et distances', () => {
    expect(formatPercent(0.5, 'fr')).toBe('50 %');
    expect(formatPercent(0.1234, 'fr', 1)).toBe('12,3 %');
    expect(formatKm(12_345, 'fr')).toBe('12,3 km');
    expect(formatKm(500, 'ar')).toContain('كم');
    expect(formatNumber(1234.5, 'fr', 1).replace(/[\s  ]/g, '')).toBe('1234,5');
  });
});

describe('montants saisis', () => {
  it.each([
    ['1,5', 1_500],
    ['1.500', 1_500],
    [' 2 ', 2_000],
    ['0,100', 100],
    ['12.345', 12_345],
    ['0', 0],
  ])('« %s » DT → %i millimes', (input, millimes) => {
    expect(parseDinars(input)).toBe(millimes);
  });

  it.each(['', 'abc', '-1', '1,2345', '1,5,5', '1e3', '1 500,5x'])('refuse « %s »', (input) => {
    expect(parseDinars(input)).toBeNull();
  });

  it('convertit les pourcentages en points de base, dans les deux sens', () => {
    expect(parsePercent('20')).toBe(2_000);
    expect(parsePercent('12,5')).toBe(1_250);
    expect(parsePercent('12,555')).toBeNull();
    expect(parsePercent('-5')).toBeNull();
    expect(toPercentInput(2_000)).toBe('20.00');
    expect(toDinarsInput(1_500)).toBe('1.500');
    expect(parseDinars(toDinarsInput(7_300))).toBe(7_300);
    expect(parsePercent(toPercentInput(1_725))).toBe(1_725);
  });
});

describe('parseSignedDinars', () => {
  it('accepte un signe pour les ajustements (« -5 » : le chauffeur doit 5 DT de plus)', () => {
    expect(parseSignedDinars('-5')).toBe(-5_000);
    expect(parseSignedDinars('-2,5')).toBe(-2_500);
    expect(parseSignedDinars('+2,5')).toBe(2_500);
    expect(parseSignedDinars('5')).toBe(5_000);
    expect(parseSignedDinars('  -0,100 ')).toBe(-100);
  });

  it.each(['', '-', '+', '--5', '-abc', '5-', '1,2345', '- -5'])('refuse « %s »', (input) => {
    expect(parseSignedDinars(input)).toBeNull();
  });
});

describe('exampleFare (même formule que l\'API)', () => {
  const standard = { baseFare: 1_500, perKm: 700, perMinute: 100, minimumFare: 4_000, bookingFee: 0 };

  it('applique tarif au km et à la minute, arrondi à 100 millimes', () => {
    // 1500 + 10×700 + 20×100 = 10 500
    expect(exampleFare(standard, 10, 20)).toBe(10_500);
    expect(exampleFare({ ...standard, perKm: 733 }, 10, 20) % 100).toBe(0);
  });

  it('respecte le minimum de course et ajoute les frais de réservation', () => {
    expect(exampleFare(standard, 0.5, 2)).toBe(4_000);
    expect(exampleFare({ ...standard, bookingFee: 500 }, 0.5, 2)).toBe(4_500);
  });
});

describe('niceScale', () => {
  it('donne un sommet multiple du pas, jamais sous le maximum', () => {
    for (const max of [1, 3, 7, 12, 47, 99, 1_234, 15_800]) {
      const { max: top, ticks } = niceScale(max);
      expect(top).toBeGreaterThanOrEqual(max);
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)).toBe(top);
      expect(ticks.length).toBeLessThanOrEqual(7);
    }
  });

  it('impose un pas entier pour les comptages et gère les séries vides', () => {
    expect(niceScale(3, 4, true).ticks).toEqual([0, 1, 2, 3]);
    expect(niceScale(0).max).toBeGreaterThan(0);
    expect(niceScale(0, 4, true).ticks).toEqual([0, 1]);
    expect(niceScale(12, 4, true).ticks.every(Number.isInteger)).toBe(true);
  });
});

describe('labelIndices', () => {
  it('nomme tous les points quand ils sont peu nombreux', () => {
    expect(labelIndices(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('espace les étiquettes et nomme toujours le dernier point', () => {
    for (const count of [30, 90]) {
      const indices = labelIndices(count);
      expect(indices.at(-1)).toBe(count - 1);
      expect(indices.length).toBeLessThanOrEqual(8);
      const gaps = indices.slice(1).map((v, i) => v - indices[i]!);
      expect(new Set(gaps).size).toBe(1);
    }
  });
});

describe('describeAudit', () => {
  it('résume une modification de tarification avant → après', () => {
    const text = describeAudit(
      'pricing.update',
      { category: 'standard', before: { baseFare: 1_500, commissionBps: 2_000 }, after: { baseFare: 2_500, commissionBps: 1_500 } },
      'fr',
    );
    expect(text).toContain('Standard');
    expect(text).toContain('Prise en charge');
    expect(text.replace(/[\s  ]/g, '')).toContain('1,500DT→2,500DT');
    expect(text.replace(/[\s  ]/g, '')).toContain('20,00%→15,00%');
    expect(text).not.toContain('(DT)');
  });

  it('résume un règlement et un ajustement de portefeuille, avec leur signe', () => {
    const spaces = (text: string) => text.replace(/[\s  ]/g, '');
    expect(spaces(describeAudit('wallet.settlement', { amount: 10_000, note: 'Remise en main propre' }, 'fr'))).toBe(
      '10,000DT—Remiseenmainpropre',
    );
    const penalty = spaces(describeAudit('wallet.adjustment', { amount: -5_000, reason: 'Pénalité' }, 'fr'));
    expect(penalty).toContain('5,000DT');
    expect(penalty).toContain('Pénalité');
    expect(penalty.startsWith('+')).toBe(false);
    expect(spaces(describeAudit('wallet.adjustment', { amount: 2_500, reason: 'Correction' }, 'fr')).startsWith('+2,500DT')).toBe(true);
    expect(describeAudit('wallet.settlement', { amount: 'x' }, 'fr')).toBe('');
  });

  it('indique le motif et le type de document', () => {
    expect(describeAudit('document.reject', { type: 'cin', reason: 'Photo floue' }, 'fr')).toBe('Carte d’identité (CIN) — Photo floue');
    expect(describeAudit('driver.reject', { reason: 'Permis expiré' }, 'fr')).toBe('Permis expiré');
    expect(describeAudit('ticket.update', { status: 'resolved' }, 'ar')).toBe('تم الحل');
  });

  it('ne plante pas et n\'affiche rien sur un détail inattendu', () => {
    for (const details of [null, undefined, 'texte', 42, [], { before: 1 }, { category: 'standard', before: 'x', after: [] }]) {
      expect(describeAudit('pricing.update', details, 'fr')).toBe('');
    }
    expect(describeAudit('driver.approve', {}, 'fr')).toBe('');
  });
});
