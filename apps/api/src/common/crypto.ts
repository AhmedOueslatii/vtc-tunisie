import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function hmac(secret: string | Buffer, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Chiffrement applicatif des données sensibles (n° CIN, n° de permis).
 * Format : `v1:<iv>.<tag>.<ciphertext>` en base64url. Le préfixe de version permet la rotation de clé.
 */
export class FieldCipher {
  private readonly key: Buffer;
  private readonly lookupKey: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY doit faire 32 octets');
    this.lookupKey = createHmac('sha256', this.key).update('lookup').digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const [version, rest] = payload.split(':', 2);
    if (version !== 'v1' || !rest) throw new Error('Format chiffré inconnu');
    const [iv, tag, ct] = rest.split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv!);
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(ct!), decipher.final()]).toString('utf8');
  }

  /** Empreinte déterministe pour garantir l'unicité sans stocker la valeur en clair. */
  lookupHash(plain: string): string {
    return hmac(this.lookupKey, plain.trim().toUpperCase());
  }
}
