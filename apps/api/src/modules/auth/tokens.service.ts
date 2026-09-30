import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from '../../common/crypto.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { DB, type Db } from '../../db/db.js';
import { sessions, users } from '../../db/schema.js';

export interface AuthUser {
  id: string;
  isAdmin: boolean;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresInS: number;
  refreshToken: string;
}

const ISSUER = 'vtc-api';
const AUDIENCE = 'vtc-apps';
/**
 * Sur un réseau mobile instable, le client peut renvoyer le même refresh token si la réponse
 * précédente s'est perdue. Dans cette fenêtre, on ne le traite pas comme un vol de jeton.
 */
const REUSE_GRACE_MS = 30_000;

const refreshInvalid = () => new AppError('REFRESH_INVALID', 'Session invalide, se reconnecter', HttpStatus.UNAUTHORIZED);

@Injectable()
export class TokensService {
  private readonly secret = new TextEncoder().encode(env().JWT_ACCESS_SECRET);

  constructor(@Inject(DB) private readonly db: Db) {}

  async issue(user: AuthUser, userAgent?: string, familyId: string = randomUUID()): Promise<TokenPair> {
    const { JWT_ACCESS_TTL_S, REFRESH_TTL_DAYS } = env();
    const accessToken = await new SignJWT(user.isAdmin ? { adm: true } : {})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${JWT_ACCESS_TTL_S}s`)
      .sign(this.secret);

    const refreshToken = randomToken();
    await this.db.insert(sessions).values({
      userId: user.id,
      familyId,
      tokenHash: sha256(refreshToken),
      userAgent: userAgent?.slice(0, 255),
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000),
    });
    return { accessToken, accessTokenExpiresInS: JWT_ACCESS_TTL_S, refreshToken };
  }

  async verifyAccess(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(token, this.secret, { issuer: ISSUER, audience: AUDIENCE });
      if (!payload.sub) throw new Error('sub manquant');
      return { id: payload.sub, isAdmin: payload.adm === true };
    } catch {
      throw new AppError('TOKEN_INVALID', 'Jeton invalide ou expiré', HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Rotation : l'ancien refresh token est révoqué. Sa réutilisation après le délai de grâce
   * signale un vol probable et révoque toute la famille (toutes les rotations de cette connexion).
   */
  async rotate(refreshToken: string, userAgent?: string): Promise<TokenPair> {
    const [session] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, sha256(refreshToken)));
    if (!session || session.expiresAt < new Date()) throw refreshInvalid();

    if (!session.revokedAt) {
      await this.db
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'rotated' })
        .where(and(eq(sessions.id, session.id), isNull(sessions.revokedAt)));
    } else {
      const inGrace =
        session.revokedReason === 'rotated' &&
        Date.now() - session.revokedAt.getTime() <= REUSE_GRACE_MS &&
        !(await this.isFamilyClosed(session.familyId));
      if (!inGrace) {
        await this.revokeFamily(session.familyId, 'reuse');
        throw refreshInvalid();
      }
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, session.userId));
    if (!user || user.status !== 'active') {
      await this.revokeFamily(session.familyId, 'suspended');
      throw new AppError('ACCOUNT_SUSPENDED', 'Compte suspendu', HttpStatus.FORBIDDEN);
    }
    return this.issue({ id: user.id, isAdmin: user.isAdmin }, userAgent, session.familyId);
  }

  async revoke(refreshToken: string): Promise<void> {
    const [session] = await this.db
      .select({ familyId: sessions.familyId })
      .from(sessions)
      .where(eq(sessions.tokenHash, sha256(refreshToken)));
    if (session) await this.revokeFamily(session.familyId, 'logout');
  }

  /** Une famille est fermée dès qu'une de ses sessions a été révoquée pour une autre raison qu'une rotation. */
  private async isFamilyClosed(familyId: string): Promise<boolean> {
    const [closed] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.familyId, familyId), ne(sessions.revokedReason, 'rotated')))
      .limit(1);
    return !!closed;
  }

  private async revokeFamily(familyId: string, reason: 'logout' | 'reuse' | 'suspended') {
    const revoked = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    // Famille entièrement tournée (aucune session active) : on marque la plus récente pour la fermer.
    if (revoked.length === 0) {
      const [latest] = await this.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.familyId, familyId))
        .orderBy(desc(sessions.createdAt))
        .limit(1);
      if (latest) await this.db.update(sessions).set({ revokedReason: reason }).where(eq(sessions.id, latest.id));
    }
  }
}
