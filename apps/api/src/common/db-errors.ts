/** Nom de la contrainte violée si l'erreur est une violation d'unicité Postgres (23505), sinon `null`. */
export function uniqueViolation(error: unknown): string | null {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const pgError = e as { code?: string; constraint?: string };
    if (pgError.code === '23505') return pgError.constraint ?? '';
  }
  return null;
}
