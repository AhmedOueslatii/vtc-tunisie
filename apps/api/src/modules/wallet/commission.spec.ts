import { describe, expect, it } from 'vitest';
import { commissionOf, debtOf, debtState } from './commission.js';

describe('commissionOf', () => {
  it('applique le taux en points de base (2000 = 20 %)', () => {
    expect(commissionOf(21_400, 2_000)).toBe(4_280);
    expect(commissionOf(10_000, 1_000)).toBe(1_000);
    expect(commissionOf(10_000, 0)).toBe(0);
  });

  it('arrondit au millime le plus proche, jamais à une fraction', () => {
    expect(Number.isInteger(commissionOf(12_345, 1_725))).toBe(true);
    expect(commissionOf(12_345, 1_725)).toBe(2_130); // 2129,5125 → 2130
    expect(commissionOf(1, 5_000)).toBe(1); // 0,5 → 1
    expect(commissionOf(3, 1_000)).toBe(0); // 0,3 → 0
  });

  it('est proportionnelle : la commission ne dépasse jamais le prix', () => {
    for (const price of [100, 4_000, 21_400, 99_900]) for (const bps of [0, 500, 2_000, 5_000]) {
      expect(commissionOf(price, bps)).toBeLessThanOrEqual(price);
    }
  });
});

describe('debtOf', () => {
  it('ne voit une dette que dans un solde négatif', () => {
    expect(debtOf(-4_280)).toBe(4_280);
    expect(debtOf(0)).toBe(0);
    expect(debtOf(1_500)).toBe(0); // la plateforme doit de l'argent au chauffeur : pas de dette
  });
});

describe('debtState', () => {
  const ceiling = 50_000;

  it('passe de ok à avertissement à 80 % du plafond, puis bloque au plafond', () => {
    expect(debtState(0, ceiling)).toBe('ok');
    expect(debtState(39_999, ceiling)).toBe('ok');
    expect(debtState(40_000, ceiling)).toBe('warning');
    expect(debtState(49_999, ceiling)).toBe('warning');
    expect(debtState(50_000, ceiling)).toBe('blocked');
    expect(debtState(120_000, ceiling)).toBe('blocked');
  });

  it('suit le plafond configuré', () => {
    expect(debtState(900, 1_000)).toBe('warning');
    expect(debtState(1_000, 1_000)).toBe('blocked');
    expect(debtState(900, 100_000)).toBe('ok');
  });
});
