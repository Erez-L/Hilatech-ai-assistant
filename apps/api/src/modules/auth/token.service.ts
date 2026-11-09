import { randomUUID } from 'node:crypto';

import {
  API_PREFIX,
  type AccessTokenClaims,
  REFRESH_COOKIE_NAME,
  accessTokenClaimsSchema,
} from '@hilatech/contracts';
import { type RefreshToken, type User } from '@hilatech/database';
import { addMs, generateOpaqueToken, sha256 } from '@hilatech/shared';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type CookieOptions } from 'express';

import { type RequestMeta } from '../../common/request';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface IssuedTokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  familyId: string;
}

export type RotationOutcome =
  | { outcome: 'invalid' }
  | { outcome: 'reused'; userId: string; familyId: string; revokedCount: number }
  | { outcome: 'revoked'; userId: string; familyId: string }
  | { outcome: 'expired'; userId: string; familyId: string }
  | { outcome: 'inactive'; userId: string; familyId: string }
  | {
      outcome: 'rotated';
      user: Pick<User, 'id' | 'email' | 'isActive'>;
      familyId: string;
      tokens: IssuedTokens;
    };

/**
 * Access JWTs + opaque refresh tokens (ADR-005).
 * Refresh tokens are 48 random bytes, stored as SHA-256, grouped in a `familyId` (= session). Every
 * refresh rotates the token; presenting an already-rotated token revokes the whole family.
 */
@Injectable()
export class TokenService {
  readonly refreshCookieName = REFRESH_COOKIE_NAME;
  private readonly accessTtlMs: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {
    this.accessTtlMs = config.get('accessTtlMs');
    this.refreshTtlMs = config.get('refreshTtlMs');
  }

  get accessTtlSeconds(): number {
    return Math.floor(this.accessTtlMs / 1000);
  }

  signAccessToken(user: Pick<User, 'id' | 'email'>, sessionId: string): string {
    const claims: Omit<AccessTokenClaims, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      sid: sessionId,
    };
    return this.jwt.sign(claims, { expiresIn: this.accessTtlSeconds });
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const payload: unknown = this.jwt.verify(token);
    return accessTokenClaimsSchema.parse(payload);
  }

  /** Starts a brand-new session (login / register): new family, first refresh token, access token. */
  async createSession(user: Pick<User, 'id' | 'email'>, meta: RequestMeta): Promise<IssuedTokens> {
    const familyId = randomUUID();
    const refresh = await this.storeRefreshToken(user.id, familyId, meta);
    return {
      accessToken: this.signAccessToken(user, familyId),
      expiresIn: this.accessTtlSeconds,
      refreshToken: refresh.raw,
      refreshExpiresAt: refresh.row.expiresAt,
      familyId,
    };
  }

  /** Rotates a refresh token. Detects reuse (already rotated/revoked) and revokes the family. */
  async rotate(rawToken: string, meta: RequestMeta): Promise<RotationOutcome> {
    const tokenHash = sha256(rawToken);
    const existing = await this.prisma.client.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, isActive: true } } },
    });
    if (!existing) return { outcome: 'invalid' };

    if (existing.replacedByTokenId) {
      // The token was already rotated: whoever presents it now is replaying a stolen or stale token.
      const revokedCount = await this.revokeFamily(existing.familyId);
      return {
        outcome: 'reused',
        userId: existing.userId,
        familyId: existing.familyId,
        revokedCount,
      };
    }
    if (existing.revokedAt) {
      // Revoked by logout / password change / an earlier reuse detection — nothing new to revoke.
      return { outcome: 'revoked', userId: existing.userId, familyId: existing.familyId };
    }

    const now = new Date();
    if (existing.expiresAt <= now) {
      await this.prisma.client.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: now },
      });
      return { outcome: 'expired', userId: existing.userId, familyId: existing.familyId };
    }
    if (!existing.user.isActive) {
      await this.revokeFamily(existing.familyId);
      return { outcome: 'inactive', userId: existing.userId, familyId: existing.familyId };
    }

    const raw = generateOpaqueToken();
    const created = await this.prisma.client.$transaction(async (tx) => {
      // Atomically claim the current token; a concurrent refresh with the same token loses the race.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null, replacedByTokenId: null },
        data: { revokedAt: now },
      });
      if (claimed.count !== 1) return null;
      const next = await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          familyId: existing.familyId,
          tokenHash: sha256(raw),
          expiresAt: addMs(now, this.refreshTtlMs),
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress,
        },
      });
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { replacedByTokenId: next.id },
      });
      return next;
    });

    if (!created) {
      const revokedCount = await this.revokeFamily(existing.familyId);
      return {
        outcome: 'reused',
        userId: existing.userId,
        familyId: existing.familyId,
        revokedCount,
      };
    }

    return {
      outcome: 'rotated',
      user: existing.user,
      familyId: existing.familyId,
      tokens: {
        accessToken: this.signAccessToken(existing.user, existing.familyId),
        expiresIn: this.accessTtlSeconds,
        refreshToken: raw,
        refreshExpiresAt: created.expiresAt,
        familyId: existing.familyId,
      },
    };
  }

  /** Finds the live token row for a raw refresh token (used by logout). */
  async findLive(rawToken: string): Promise<RefreshToken | null> {
    return this.prisma.client.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
  }

  /** Revokes every token of a session family. Returns the number of tokens revoked. */
  async revokeFamily(familyId: string, userId?: string): Promise<number> {
    const result = await this.prisma.client.refreshToken.updateMany({
      where: { familyId, revokedAt: null, ...(userId ? { userId } : {}) },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Revokes all sessions of a user, optionally keeping one family (the current one). */
  async revokeAllForUser(userId: string, exceptFamilyId?: string): Promise<number> {
    const result = await this.prisma.client.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  cookieOptions(expires?: Date): CookieOptions {
    const domain = this.config.get('COOKIE_DOMAIN');
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('COOKIE_SECURE'),
      path: `${API_PREFIX}/auth`,
      ...(domain ? { domain } : {}),
      ...(expires ? { expires } : {}),
    };
  }

  private async storeRefreshToken(
    userId: string,
    familyId: string,
    meta: RequestMeta,
  ): Promise<{ raw: string; row: RefreshToken }> {
    const raw = generateOpaqueToken();
    const row = await this.prisma.client.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(raw),
        expiresAt: addMs(new Date(), this.refreshTtlMs),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });
    return { raw, row };
  }
}
