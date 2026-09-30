/**
 * Numéros tunisiens : indicatif +216, 8 chiffres.
 * Préfixes mobiles : 2x (Ooredoo), 4x, 5x (Orange), 9x (Tunisie Telecom), 3x (plans récents).
 * Les fixes (7x) sont refusés : un OTP par SMS doit arriver sur un mobile.
 * [À VALIDER] la liste des préfixes auprès des opérateurs avant la mise en production.
 */
const MOBILE_NATIONAL = /^[23459]\d{7}$/;

/** Normalise une saisie utilisateur en E.164 (`+216XXXXXXXX`), ou `null` si invalide. */
export function normalizeTunisianMobile(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+216')) digits = digits.slice(4);
  else if (digits.startsWith('00216')) digits = digits.slice(5);
  else if (digits.startsWith('216') && digits.length === 11) digits = digits.slice(3);
  return MOBILE_NATIONAL.test(digits) ? `+216${digits}` : null;
}
