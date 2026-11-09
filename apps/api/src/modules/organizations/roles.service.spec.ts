import { ALL_PERMISSIONS, ErrorCode, Permission, SystemRole } from '@hilatech/contracts';

import { AppException } from '../../common/errors/app.exception';
import { createAuditMock, createPrismaMock } from '../../test-utils/prisma.mock';
import { type AuditService } from '../audit/audit.service';
import { RoleRules, RolesService } from './roles.service';

const ORG = '22222222-2222-4222-8222-222222222222';
const tenant = {
  organizationId: ORG,
  userId: 'u1',
  memberId: 'm1',
  roleId: 'r1',
  roleKey: 'owner',
  permissions: ALL_PERMISSIONS,
};
const meta = { ipAddress: null, userAgent: null, requestId: null };
const now = new Date();
const ownerRole = {
  id: 'r1',
  organizationId: ORG,
  key: 'owner',
  name: 'Owner',
  description: null,
  isSystem: true,
  permissions: [...ALL_PERMISSIONS],
  createdAt: now,
  updatedAt: now,
};
const customRole = {
  ...ownerRole,
  id: 'r9',
  key: 'sales',
  name: 'Sales',
  isSystem: false,
  permissions: [Permission.LEADS_READ],
};

describe('RoleRules', () => {
  it('rejects unknown permission keys with 400 VALIDATION_ERROR listing them', () => {
    expect(() => RoleRules.assertKnownPermissions([Permission.LEADS_READ])).not.toThrow();
    const error = (() => {
      try {
        RoleRules.assertKnownPermissions([Permission.LEADS_READ, 'leads:fly', 'nope']);
      } catch (e) {
        return e as AppException;
      }
      return undefined;
    })();
    expect(error?.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(JSON.stringify(error?.details)).toContain('leads:fly');
    expect(JSON.stringify(error?.details)).toContain('nope');
  });

  it('forbids reducing owner permissions but allows changing other system roles', () => {
    const reduced = ALL_PERMISSIONS.filter((p) => p !== Permission.ORG_DELETE);
    expect(() => RoleRules.assertOwnerNotReduced(ownerRole, reduced)).toThrow(AppException);
    expect(() => RoleRules.assertOwnerNotReduced(ownerRole, [...ALL_PERMISSIONS])).not.toThrow();
    expect(() =>
      RoleRules.assertOwnerNotReduced({ key: 'admin', isSystem: true }, [Permission.ORG_READ]),
    ).not.toThrow();
    expect(() =>
      RoleRules.assertOwnerNotReduced({ key: 'owner', isSystem: false }, []),
    ).not.toThrow();
  });

  it('reserves system role keys and forbids renaming system roles', () => {
    for (const key of Object.values(SystemRole))
      expect(() => RoleRules.assertNotSystemKey(key)).toThrow(AppException);
    expect(() => RoleRules.assertNotSystemKey('sales')).not.toThrow();
    expect(() => RoleRules.assertRenameAllowed(ownerRole, { name: 'Boss' })).toThrow(AppException);
    expect(() =>
      RoleRules.assertRenameAllowed(ownerRole, { name: 'Owner', description: 'x' }),
    ).not.toThrow();
    expect(() => RoleRules.assertRenameAllowed(customRole, { name: 'Renamed' })).not.toThrow();
  });

  it('only deletes custom roles with no members and no pending invitations', () => {
    expect(() => RoleRules.assertDeletable(ownerRole, 0, 0)).toThrow(AppException);
    expect(() => RoleRules.assertDeletable(customRole, 2, 0)).toThrow(
      expect.objectContaining({ code: ErrorCode.CONFLICT }),
    );
    expect(() => RoleRules.assertDeletable(customRole, 0, 1)).toThrow(
      expect.objectContaining({ code: ErrorCode.CONFLICT }),
    );
    expect(() => RoleRules.assertDeletable(customRole, 0, 0)).not.toThrow();
  });
});

describe('RolesService', () => {
  function build() {
    const { service: prisma, client } = createPrismaMock();
    const audit = createAuditMock();
    const service = new RolesService(prisma, audit as unknown as AuditService);
    return { service, client, audit };
  }

  it('never returns roles of another organization (scoped lookup → 404)', async () => {
    const { service, client } = build();
    client.role.findFirst.mockResolvedValue(null);
    await expect(service.get(tenant, 'foreign')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(client.role.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', organizationId: ORG },
    });
  });

  it('refuses to reduce the owner role permissions via update', async () => {
    const { service, client } = build();
    client.role.findFirst.mockResolvedValue(ownerRole);
    await expect(
      service.update(tenant, ownerRole.id, { permissions: [Permission.ORG_READ] }, meta),
    ).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(client.role.update).not.toHaveBeenCalled();
  });

  it('refuses to delete a system role and a role that still has members', async () => {
    const { service, client } = build();
    client.role.findFirst.mockResolvedValue(ownerRole);
    client.organizationMember.count.mockResolvedValue(0);
    client.invitation.count.mockResolvedValue(0);
    await expect(service.remove(tenant, ownerRole.id, meta)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });

    client.role.findFirst.mockResolvedValue(customRole);
    client.organizationMember.count.mockResolvedValue(1);
    await expect(service.remove(tenant, customRole.id, meta)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
    expect(client.role.delete).not.toHaveBeenCalled();
  });

  it('creates custom roles with de-duplicated, validated permissions and audits', async () => {
    const { service, client, audit } = build();
    client.role.findUnique.mockResolvedValue(null);
    client.role.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...customRole,
      ...data,
    }));
    const role = await service.create(
      tenant,
      { key: 'sales', name: 'Sales', permissions: [Permission.LEADS_READ, Permission.LEADS_READ] },
      meta,
    );
    expect(role.permissions).toEqual([Permission.LEADS_READ]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'role.created', organizationId: ORG }),
    );
  });

  it('rejects duplicate keys with 409', async () => {
    const { service, client } = build();
    client.role.findUnique.mockResolvedValue({ id: 'dup' });
    await expect(
      service.create(tenant, { key: 'sales', name: 'Sales', permissions: [] }, meta),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
  });
});
