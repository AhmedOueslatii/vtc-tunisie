import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * L'API renvoie des codes stables (`{ code, message }`) que les apps traduisent en fr/ar.
 * `message` est destiné aux développeurs, jamais affiché tel quel à l'utilisateur.
 */
export class AppError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: Record<string, unknown>,
  ) {
    super({ code, message, ...(details ? { details } : {}) }, status);
  }
}

export const Errors = {
  validation: (issues: unknown) =>
    new AppError('VALIDATION_FAILED', 'Requête invalide', HttpStatus.BAD_REQUEST, { issues }),
  unauthorized: () => new AppError('UNAUTHORIZED', 'Authentification requise', HttpStatus.UNAUTHORIZED),
  forbidden: () => new AppError('FORBIDDEN', 'Accès refusé', HttpStatus.FORBIDDEN),
  notFound: (what: string) => new AppError('NOT_FOUND', `${what} introuvable`, HttpStatus.NOT_FOUND),
  conflict: (code: string, message: string) => new AppError(code, message, HttpStatus.CONFLICT),
};
