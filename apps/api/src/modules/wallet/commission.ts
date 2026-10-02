/**
 * Règles du portefeuille chauffeur, sans accès base de données (donc testables) et partagées par les modules qui en
 * dépendent. Tous les montants sont en millimes ; un solde négatif est une dette de commissions envers la plateforme.
 */

/** Commission sur une course : arrondie au millime le plus proche (2000 points de base = 20 %). */
export const commissionOf = (price: number, commissionBps: number): number => Math.round((price * commissionBps) / 10_000);

export const debtOf = (balance: number): number => Math.max(0, -balance);

/** Part du plafond à partir de laquelle le chauffeur est prévenu. */
export const WARNING_RATIO = 0.8;

export type DebtState = 'ok' | 'warning' | 'blocked';

/** `blocked` : le chauffeur ne peut plus passer en ligne tant qu'il n'a pas réglé une partie de sa dette. */
export function debtState(debt: number, ceiling: number): DebtState {
  if (debt >= ceiling) return 'blocked';
  if (debt >= ceiling * WARNING_RATIO) return 'warning';
  return 'ok';
}
