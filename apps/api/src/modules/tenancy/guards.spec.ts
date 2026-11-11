import { AuditAction, ErrorCode, ORGANIZATION_HEADER, Permission } from '@hilatech/contracts';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { NO_TENANT_KEY } from '../../common/decorators/no-tenant.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { AppException } from '../../common/errors/app.exception';
import { createAuditMock } from '../../test-utils/prisma.mock';
import { type AuditService } from '../audit/audit.service';
import { OrganizationGuard } from './organization.guard';
import { PermissionsGuard } from './permissions.guard';
import { type TenancyService } from './tenancy.service';

const ORG = '22222222-2222-4222-8222-222222222222';
const principal = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'a@example.com',
  sessionId: 's',
  emailVerified: true,
};

function contextFor(
  req: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): ExecutionContext {
  const handler = () => undefined;
  const cls = class Ctrl {};
  for (const [key, value] of Object.entries(metadata)) Reflect.defineMetadata(key, value, handler);
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('OrganizationGuard', () => {
  function build() {
    const audit = createAuditMock();
    const tenancy = { resolveTenant: jest.fn() };
    const guard = new OrganizationGuard(
      new Reflector(),
      tenancy as unknown as TenancyService,
      audit as unknown as AuditService,
    );
    return { guard, audit, tenancy };
  }

  it('skips @Public() and @NoTenant() routes', async () => {
    const { guard, tenancy } = build();
    await expect(guard.canActivate(contextFor({}, { [IS_PUBLIC_KEY]: true }))).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor({ user: principal }, { [NO_TENANT_KEY]: true })),
    ).resolves.toBe(true);
    expect(tenancy.resolveTenant).not.toHaveBeenCalled();
  });

  it('returns 400 ORGANIZATION_REQUIRED when the header is missing or not a uuid', async () => {
    const { guard } = build();
    await expect(
      guard.canActivate(contextFor({ user: principal, headers: {} })),
    ).rejects.toMatchObject({
      code: ErrorCode.ORGANIZATION_REQUIRED,
    });
    await expect(
      guard.canActivate(
        contextFor({ user: principal, headers: { [ORGANIZATION_HEADER]: 'not-a-uuid' } }),
      ),
    ).rejects.toMatchObject({ code: ErrorCode.ORGANIZATION_REQUIRED });
  });

  it('returns 403 NOT_A_MEMBER and audits a tenant violation for non-members', async () => {
    const { guard, tenancy, audit } = build();
    tenancy.resolveTenant.mockResolvedValue(null);
    const req = {
      user: principal,
      headers: { [ORGANIZATION_HEADER]: ORG },
      method: 'GET',
      originalUrl: '/api/v1/members',
      ip: '1.1.1.1',
    };
    const error = await guard.canActivate(contextFor(req)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe(ErrorCode.NOT_A_MEMBER);
    expect((error as AppException).getStatus()).toBe(403);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.TENANT_VIOLATION_ATTEMPT,
        actorUserId: principal.userId,
        metadata: expect.objectContaining({ attemptedOrganizationId: ORG }),
      }),
    );
  });

  it('attaches the resolved TenantContext for active members', async () => {
    const { guard, tenancy } = build();
    const tenant = {
      organizationId: ORG,
      userId: principal.userId,
      memberId: 'm',
      roleId: 'r',
      roleKey: 'admin',
      permissions: ['organization:read'],
    };
    tenancy.resolveTenant.mockResolvedValue(tenant);
    const req: Record<string, unknown> = {
      user: principal,
      headers: { [ORGANIZATION_HEADER]: ORG },
    };
    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
    expect(req.tenant).toEqual(tenant);
    expect(tenancy.resolveTenant).toHaveBeenCalledWith(principal.userId, ORG);
  });

  it('rejects when no principal is present (defensive)', async () => {
    const { guard } = build();
    await expect(
      guard.canActivate(contextFor({ headers: { [ORGANIZATION_HEADER]: ORG } })),
    ).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
  });
});

describe('PermissionsGuard', () => {
  function build() {
    const audit = createAuditMock();
    const guard = new PermissionsGuard(new Reflector(), audit as unknown as AuditService);
    return { guard, audit };
  }
  const tenant = {
    organizationId: ORG,
    userId: principal.userId,
    memberId: 'm',
    roleId: 'r',
    roleKey: 'member',
    permissions: [Permission.ORG_READ, Permission.MEMBERS_READ],
  };

  it('allows routes without @RequirePermissions', async () => {
    const { guard } = build();
    await expect(guard.canActivate(contextFor({ tenant }))).resolves.toBe(true);
  });

  it('allows when every required permission is granted', async () => {
    const { guard, audit } = build();
    const ctx = contextFor(
      { tenant },
      { [PERMISSIONS_KEY]: [Permission.ORG_READ, Permission.MEMBERS_READ] },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('denies with 403 FORBIDDEN and audits security.permission_denied when one permission is missing', async () => {
    const { guard, audit } = build();
    const ctx = contextFor(
      { tenant, method: 'DELETE', originalUrl: '/api/v1/members/x' },
      { [PERMISSIONS_KEY]: [Permission.MEMBERS_READ, Permission.MEMBERS_REMOVE] },
    );
    const error = await guard.canActivate(ctx).catch((e: unknown) => e);
    expect((error as AppException).code).toBe(ErrorCode.FORBIDDEN);
    expect((error as AppException).getStatus()).toBe(403);
    expect((error as AppException).details).toEqual({ required: [Permission.MEMBERS_REMOVE] });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PERMISSION_DENIED,
        organizationId: ORG,
        actorUserId: principal.userId,
        metadata: expect.objectContaining({ missing: [Permission.MEMBERS_REMOVE] }),
      }),
    );
  });

  it('denies when permissions are required but no tenant was resolved', async () => {
    const { guard } = build();
    await expect(
      guard.canActivate(contextFor({}, { [PERMISSIONS_KEY]: [Permission.ORG_READ] })),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
  });
});
