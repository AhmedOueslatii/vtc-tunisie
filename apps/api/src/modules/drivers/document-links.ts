import { hmac, safeEqual } from '../../common/crypto.js';

/**
 * Liens signés vers les scans de documents. Le navigateur de l'admin charge l'image directement depuis l'API, sans
 * passer par le serveur du back-office. Le lien est une capacité : qui le possède peut lire CE document jusqu'à
 * l'expiration, et rien d'autre. D'où une durée courte, une signature liée au document, à l'admin qui l'a demandé
 * (traçabilité) et à l'échéance, et un journal d'audit à chaque émission.
 */

export interface LinkParts {
  docId: string;
  adminId: string;
  /** Échéance, en secondes Unix. */
  exp: number;
}

export type LinkCheck = 'ok' | 'expired' | 'invalid';

/** Clé dédiée à cet usage, dérivée du secret : une signature de lien ne peut pas servir ailleurs. */
const signingKey = (secret: string) => hmac(secret, 'document-link:v1');
const payload = ({ docId, adminId, exp }: LinkParts) => `${docId}.${adminId}.${exp}`;

export function signDocumentLink(secret: string, parts: LinkParts): string {
  return hmac(signingKey(secret), payload(parts));
}

export function documentLinkPath(secret: string, parts: LinkParts): string {
  const query = new URLSearchParams({ e: String(parts.exp), a: parts.adminId, s: signDocumentLink(secret, parts) });
  return `/documents/${parts.docId}/file?${query}`;
}

/** La signature est vérifiée avant l'échéance : un lien falsifié est « invalid », jamais « expired ». */
export function verifyDocumentLink(secret: string, parts: LinkParts, signature: string, nowS = Math.floor(Date.now() / 1000)): LinkCheck {
  if (!safeEqual(signDocumentLink(secret, parts), signature)) return 'invalid';
  return parts.exp > nowS ? 'ok' : 'expired';
}
