/**
 * Plaques tunisiennes : « 123 تونس 4567 » (série TU) ou « 123456 ن ت » (RS, régime suspensif).
 * Normalisées en `123TU4567` / `123456RS`. [À VALIDER] autres séries (location, diplomatique…).
 */
export function normalizePlate(raw: string): string | null {
  const plate = raw
    .toUpperCase()
    .replace(/تونس/g, 'TU')
    .replace(/ن\s*ت/g, 'RS')
    .replace(/[\s\-_.]/g, '');
  return /^(\d{1,3}TU\d{1,4}|\d{1,6}RS)$/.test(plate) ? plate : null;
}
