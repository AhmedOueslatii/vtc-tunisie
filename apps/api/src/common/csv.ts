/**
 * Exports CSV pour Excel (France/Tunisie) : séparateur « ; », virgule décimale, UTF-8 avec BOM, fins de ligne CRLF.
 * Le BOM est ce qui permet à Excel de lire correctement les accents sans passer par l'assistant d'import.
 */

export const BOM = '﻿';
const SEPARATOR = ';';

/** Montant en millimes, écrit en dinars avec trois décimales et une virgule (12300 → « 12,300 »). */
export class Money {
  constructor(readonly millimes: number) {}
}
export const money = (millimes: number | null | undefined) => (millimes === null || millimes === undefined ? null : new Money(millimes));

export type Cell = string | number | boolean | null | undefined | Date | Money;

const formatMoney = ({ millimes }: Money) => `${millimes < 0 ? '-' : ''}${Math.floor(Math.abs(millimes) / 1000)},${String(Math.abs(millimes) % 1000).padStart(3, '0')}`;

/** Date et heure à Tunis (UTC+1 toute l'année), « 2026-10-02 14:35 » : lisible et triable. */
export function tunisDateTime(date: Date): string {
  const shifted = new Date(date.getTime() + 3_600_000);
  return shifted.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Un tableur interprète comme une formule toute cellule qui commence par = + - @ (ou tabulation / retour chariot) :
 * une adresse saisie par un utilisateur pourrait alors exécuter du code à l'ouverture du fichier. On neutralise avec
 * une apostrophe, qu'Excel n'affiche pas. Les montants et nombres sont écrits par nos soins et ne passent pas par là.
 */
const neutralizeFormula = (text: string) => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Money) text = formatMoney(value);
  else if (value instanceof Date) text = tunisDateTime(value);
  else if (typeof value === 'number') text = Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
  else if (typeof value === 'boolean') text = value ? 'oui' : 'non';
  else text = neutralizeFormula(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(SEPARATOR));
  return BOM + lines.join('\r\n') + '\r\n';
}
