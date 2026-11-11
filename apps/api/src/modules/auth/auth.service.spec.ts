import { AuditAction, ErrorCode } from '@hilatech/contracts';

import { AppException } from '../../common/errors/app.exception';
import { type AppConfig } from '../../config/app-config.service';
import { type EmailService } from '../../infrastructure/email/email.service';
import { createAuditMock, createConfigMock, createPrismaMock } from '../../test-utils/prisma.mock';
import { type AuditService } from '../audit/audit.service';
import { type InvitationsService } from '../organizations/invitations.service';
import { type OrganizationsService } from '../organizations/organizations.service';
import { type TenancyService } from '../tenancy/tenancy.service';
import { AuthService } from './auth.service';
import { type TokenService } from './token.service';

const meta = { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' };
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a@example.com',
  firstName: 'A',
  lastName: 'B',
  avatarUrl: null,
  emailVerifiedAt: null,
  createdAt: new Date(),
  isActive: true,
  passwordHash: 'x',
};

function build() {
  const { service: prisma, client } = createPrismaMock();
  const audit = createAuditMock();
  const tokens = {
    rotate: jest.fn(),
    createSession: jest.fn(),
    revokeFamily: jest.fn().mockResolvedValue(1),
    revokeAllForUser: jest.fn().mockResolvedValue(0),
    findLive: jest.fn(),
    refreshCookieName: 'hta_refresh',
  };
  const organizations = { listForUser: jest.fn().mockResolvedValue([]) };
  const email = { send: jest.fn().mockResolvedValue({ jobId: 'j' }) };
  const invitations = {
    findByToken: jest.fn(),
    acceptInTransaction: jest.fn(),
    afterAccept: jest.fn(),
  };
  const tenancy = { resolveTenant: jest.fn() };
  const config = createConfigMock({
    APP_URL: 'http://app',
    passwordResetTtlMs: 3_600_000,
    emailVerificationTtlMs: 86_400_000,
  });
  const service = new AuthService(
    prisma,
    tokens as unknown as TokenService,
    audit as unknown as AuditService,
    email as unknown as EmailService,
    invitations as unknown as InvitationsService,
    organizations as unknown as OrganizationsService,
    tenancy as unknown as TenancyService,
    config as unknown as AppConfig,
  );
  return { service, client, audit, tokens, organizations, tenancy };
}

describe('AuthService.refresh', () => {
  it('rejects a missing cookie with TOKEN_INVALID', async () => {
    const { service } = build();
    await expect(service.refresh(undefined, meta)).rejects.toMatchObject({
      code: ErrorCode.TOKEN_INVALID,
    });
  });

  it('on reuse: audits auth.refresh_reuse_detected and throws 401 TOKEN_REUSED', async () => {
    const { service, tokens, audit } = build();
    tokens.rotate.mockResolvedValue({
      outcome: 'reused',
      userId: user.id,
      familyId: 'fam',
      revokedCount: 2,
    });

    const error = await service.refresh('stolen', meta).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe(ErrorCode.TOKEN_REUSED);
    expect((error as AppException).getStatus()).toBe(401);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.AUTH_REFRESH_REUSE_DETECTED,
        actorUserId: user.id,
        targetId: 'fam',
        metadata: expect.objectContaining({ revokedCount: 2 }),
      }),
    );
  });

  it('on rotation: audits auth.refresh and returns a new access token + cookie value', async () => {
    const { service, tokens, audit, client } = build();
    const refreshExpiresAt = new Date(Date.now() + 1000);
    tokens.rotate.mockResolvedValue({
      outcome: 'rotated',
      user,
      familyId: 'fam',
      tokens: {
        accessToken: 'jwt',
        expiresIn: 900,
        refreshToken: 'new-raw',
        refreshExpiresAt,
        familyId: 'fam',
      },
    });
    client.user.findUniqueOrThrow.mockResolvedValue(user);

    const result = await service.refresh('raw', meta);
    expect(result.refreshToken).toBe('new-raw');
    expect(result.body.accessToken).toBe('jwt');
    expect(result.body.tokenType).toBe('Bearer');
    expect(result.body.user.email).toBe(user.email);
    expect(JSON.stringify(result.body)).not.toContain('passwordHash');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.AUTH_REFRESH, actorUserId: user.id }),
    );
  });

  it.each([
    ['invalid', ErrorCode.TOKEN_INVALID],
    ['revoked', ErrorCode.TOKEN_INVALID],
    ['expired', ErrorCode.TOKEN_EXPIRED],
    ['inactive', ErrorCode.UNAUTHORIZED],
  ])('maps outcome %s to %s', async (outcome, code) => {
    const { service, tokens, audit } = build();
    tokens.rotate.mockResolvedValue({ outcome, userId: user.id, familyId: 'fam' });
    await expect(service.refresh('raw', meta)).rejects.toMatchObject({ code });
    expect(audit.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.AUTH_REFRESH_REUSE_DETECTED }),
    );
  });
});

describe('AuthService.login', () => {
  it('returns the same INVALID_CREDENTIALS error for unknown email and wrong password, and audits the failure', async () => {
    const { service, client, audit } = build();
    client.user.findUnique.mockResolvedValue(null);
    const unknown = await service
      .login({ email: 'nobody@example.com', password: 'whatever123A' }, meta)
      .catch((e: AppException) => e);

    client.user.findUnique.mockResolvedValue({
      ...user,
      passwordHash:
        '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    const wrong = await service
      .login({ email: user.email, password: 'whatever123A' }, meta)
      .catch((e: AppException) => e);

    for (const e of [unknown, wrong]) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe(ErrorCode.INVALID_CREDENTIALS);
      expect((e as AppException).message).toBe('Invalid email or password');
    }
    expect(audit.log).toHaveBeenCalledTimes(2);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.AUTH_LOGIN_FAILED }),
    );
  });
});

describe('AuthService.me', () => {
  it('resolves active organization and permissions only for a valid membership', async () => {
    const { service, client, organizations, tenancy } = build();
    client.user.findUnique.mockResolvedValue(user);
    const ORG = '22222222-2222-4222-8222-222222222222';
    const org = {
      id: ORG,
      name: 'Org',
      slug: 'org',
      logoUrl: null,
      roleKey: 'owner',
      roleName: 'Owner',
    };
    organizations.listForUser.mockResolvedValue([org]);
    const principal = { userId: user.id, email: user.email, sessionId: 's', emailVerified: true };

    tenancy.resolveTenant.mockResolvedValue(null);
    const none = await service.me(principal, '33333333-3333-4333-8333-333333333333');
    expect(none.activeOrganization).toBeNull();
    expect(none.permissions).toEqual([]);

    // a malformed header never reaches the database
    const malformed = await service.me(principal, 'not-a-uuid');
    expect(malformed.activeOrganization).toBeNull();
    expect(tenancy.resolveTenant).toHaveBeenCalledTimes(1);

    tenancy.resolveTenant.mockResolvedValue({
      organizationId: ORG,
      permissions: ['organization:read'],
    });
    const some = await service.me(principal, ORG);
    expect(some.activeOrganization).toEqual(org);
    expect(some.permissions).toEqual(['organization:read']);
  });
});
