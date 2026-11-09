import { sha256 } from '@hilatech/shared';
import { JwtService } from '@nestjs/jwt';

import { type AppConfig } from '../../config/app-config.service';
import { createConfigMock, createPrismaMock } from '../../test-utils/prisma.mock';
import { TokenService } from './token.service';

const meta = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' };
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com', isActive: true };

function build() {
  const { service: prisma, client } = createPrismaMock();
  const config = createConfigMock({
    accessTtlMs: 15 * 60_000,
    refreshTtlMs: 30 * 24 * 3_600_000,
    COOKIE_SECURE: false,
    COOKIE_DOMAIN: undefined,
  }) as unknown as AppConfig;
  const jwt = new JwtService({ secret: 'unit-test-secret-at-least-32-characters-long!!' });
  const tokens = new TokenService(jwt, prisma, config);
  return { tokens, client, jwt };
}

describe('TokenService', () => {
  it('signs access tokens with sub/email/sid claims and the configured TTL', () => {
    const { tokens, jwt } = build();
    const token = tokens.signAccessToken(user, 'family-1');
    const claims = jwt.verify<{
      sub: string;
      email: string;
      sid: string;
      exp: number;
      iat: number;
    }>(token);
    expect(claims.sub).toBe(user.id);
    expect(claims.email).toBe(user.email);
    expect(claims.sid).toBe('family-1');
    expect(claims.exp - claims.iat).toBe(900);
    expect(tokens.accessTtlSeconds).toBe(900);
  });

  it('createSession stores only the SHA-256 of the refresh token', async () => {
    const { tokens, client } = build();
    client.refreshToken.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 't1',
        ...data,
      }),
    );
    const issued = await tokens.createSession(user, meta);
    const stored = client.refreshToken.create.mock.calls[0]![0].data;
    expect(stored.tokenHash).toBe(sha256(issued.refreshToken));
    expect(stored.tokenHash).not.toBe(issued.refreshToken);
    expect(stored.userAgent).toBe('jest');
    expect(issued.familyId).toBe(stored.familyId);
  });

  describe('rotate', () => {
    const existing = {
      id: 'old-id',
      userId: user.id,
      familyId: 'fam-1',
      tokenHash: sha256('raw-old'),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedByTokenId: null,
      user,
    };

    it('returns invalid for unknown tokens', async () => {
      const { tokens, client } = build();
      client.refreshToken.findUnique.mockResolvedValue(null);
      await expect(tokens.rotate('nope', meta)).resolves.toEqual({ outcome: 'invalid' });
    });

    it('rotates a live token: revokes the old one, links the replacement, issues new tokens', async () => {
      const { tokens, client } = build();
      client.refreshToken.findUnique.mockResolvedValue(existing);
      client.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      client.refreshToken.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-id', ...data }),
      );
      client.refreshToken.update.mockResolvedValue({});

      const result = await tokens.rotate('raw-old', meta);
      expect(result.outcome).toBe('rotated');
      if (result.outcome !== 'rotated') throw new Error('unreachable');
      expect(result.tokens.refreshToken).not.toBe('raw-old');
      expect(result.familyId).toBe('fam-1');

      // old token atomically claimed
      expect(client.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-id', revokedAt: null, replacedByTokenId: null },
        }),
      );
      // replacement created in the same family with a hashed value
      const created = client.refreshToken.create.mock.calls[0]![0].data;
      expect(created.familyId).toBe('fam-1');
      expect(created.tokenHash).toBe(sha256(result.tokens.refreshToken));
      // old token linked to the replacement
      expect(client.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'old-id' },
        data: { replacedByTokenId: 'new-id' },
      });
    });

    it('detects reuse of an already-rotated token and revokes the whole family', async () => {
      const { tokens, client } = build();
      client.refreshToken.findUnique.mockResolvedValue({
        ...existing,
        replacedByTokenId: 'new-id',
        revokedAt: new Date(),
      });
      client.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      const result = await tokens.rotate('raw-old', meta);
      expect(result).toEqual({
        outcome: 'reused',
        userId: user.id,
        familyId: 'fam-1',
        revokedCount: 3,
      });
      expect(client.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(client.refreshToken.create).not.toHaveBeenCalled();
    });

    it('treats a revoked (logged-out) token as revoked without re-triggering reuse handling', async () => {
      const { tokens, client } = build();
      client.refreshToken.findUnique.mockResolvedValue({ ...existing, revokedAt: new Date() });
      const result = await tokens.rotate('raw-old', meta);
      expect(result).toEqual({ outcome: 'revoked', userId: user.id, familyId: 'fam-1' });
      expect(client.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('treats a lost concurrent claim as reuse', async () => {
      const { tokens, client } = build();
      client.refreshToken.findUnique.mockResolvedValue(existing);
      // first call: claim fails (someone else rotated concurrently); second call: family revocation
      client.refreshToken.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 2 });
      const result = await tokens.rotate('raw-old', meta);
      expect(result).toEqual({
        outcome: 'reused',
        userId: user.id,
        familyId: 'fam-1',
        revokedCount: 2,
      });
    });

    it('rejects expired tokens and marks them revoked', async () => {
      const { tokens, client } = build();
      client.refreshToken.findUnique.mockResolvedValue({
        ...existing,
        expiresAt: new Date(Date.now() - 1_000),
      });
      client.refreshToken.update.mockResolvedValue({});
      const result = await tokens.rotate('raw-old', meta);
      expect(result).toEqual({ outcome: 'expired', userId: user.id, familyId: 'fam-1' });
      expect(client.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'old-id' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('revokes the family for inactive users', async () => {
      const { tokens, client } = build();
      client.refreshToken.findUnique.mockResolvedValue({
        ...existing,
        user: { ...user, isActive: false },
      });
      client.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      const result = await tokens.rotate('raw-old', meta);
      expect(result.outcome).toBe('inactive');
    });
  });

  it('cookieOptions are httpOnly, lax and scoped to the auth path', () => {
    const { tokens } = build();
    const expires = new Date();
    expect(tokens.cookieOptions(expires)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/api/v1/auth',
      expires,
    });
  });
});
