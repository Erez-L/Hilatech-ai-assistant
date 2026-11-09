import { ALL_PERMISSIONS, Permission } from '@hilatech/contracts';
import { resolveUserPermissions, type MembershipReader } from './user-permissions';

const organizationId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

function reader(result: unknown) {
  const findFirst = jest.fn().mockResolvedValue(result);
  return { prisma: { organizationMember: { findFirst } } as unknown as MembershipReader, findFirst };
}

describe('resolveUserPermissions', () => {
  it("returns the active member's role permissions", async () => {
    const { prisma, findFirst } = reader({
      status: 'active',
      user: { isActive: true },
      role: { key: 'member', isSystem: true, permissions: ['leads:read', 'contacts:read'] },
    });
    const result = await resolveUserPermissions(prisma, organizationId, userId);
    expect(result).toEqual({
      permissions: ['leads:read', 'contacts:read'],
      membership: 'active',
      roleKey: 'member',
    });
    // Scoped to the organization and excludes deleted organizations, like the API's TenancyService.
    expect(findFirst.mock.calls[0]![0].where).toEqual({
      userId,
      organizationId,
      organization: { deletedAt: null },
    });
  });

  it('widens the system owner role to every permission', async () => {
    const { prisma } = reader({
      status: 'active',
      user: { isActive: true },
      role: { key: 'owner', isSystem: true, permissions: ['leads:read'] },
    });
    const result = await resolveUserPermissions(prisma, organizationId, userId);
    expect(result.membership).toBe('active');
    expect(new Set(result.permissions)).toEqual(new Set(ALL_PERMISSIONS));
    expect(result.permissions).toContain(Permission.AGENTS_EXECUTE);
  });

  it('does not widen a custom role that merely reuses the owner key without isSystem', async () => {
    const { prisma } = reader({
      status: 'active',
      user: { isActive: true },
      role: { key: 'owner', isSystem: false, permissions: ['leads:read'] },
    });
    expect((await resolveUserPermissions(prisma, organizationId, userId)).permissions).toEqual([
      'leads:read',
    ]);
  });

  it('returns no permissions for a missing membership', async () => {
    const { prisma } = reader(null);
    expect(await resolveUserPermissions(prisma, organizationId, userId)).toEqual({
      permissions: [],
      membership: 'missing',
      roleKey: null,
    });
  });

  it('returns no permissions for a suspended member or an inactive user', async () => {
    const suspended = reader({
      status: 'suspended',
      user: { isActive: true },
      role: { key: 'admin', isSystem: true, permissions: ['leads:read'] },
    });
    expect(await resolveUserPermissions(suspended.prisma, organizationId, userId)).toEqual({
      permissions: [],
      membership: 'inactive',
      roleKey: 'admin',
    });
    const deactivated = reader({
      status: 'active',
      user: { isActive: false },
      role: { key: 'admin', isSystem: true, permissions: ['leads:read'] },
    });
    expect(
      (await resolveUserPermissions(deactivated.prisma, organizationId, userId)).membership,
    ).toBe('inactive');
  });
});
