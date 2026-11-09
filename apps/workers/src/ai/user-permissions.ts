import { ALL_PERMISSIONS, SystemRole } from '@hilatech/contracts';
import type { PrismaClient } from '@hilatech/database';

export type MembershipState = 'active' | 'missing' | 'inactive';

export interface ResolvedUserPermissions {
  /** Effective tenant permissions. Empty when the user is not an active member (denies every gated tool). */
  permissions: string[];
  membership: MembershipState;
  roleKey: string | null;
}

/** The Prisma surface this helper uses (so unit tests can pass a mock). */
export type MembershipReader = Pick<PrismaClient, 'organizationMember'>;

/**
 * Mirror of the API's `TenancyService.resolveTenant`: the triggering user's permissions are those of
 * their **active** membership's role, only while the organization is not deleted and the user is
 * active. The system `owner` role always carries every permission (ADR-006 — it cannot be reduced), so
 * it is widened to `ALL_PERMISSIONS` defensively even if a row were ever out of sync.
 *
 * No active membership → `[]`: the run proceeds (the execution row exists and must be resolved) but
 * every permission-gated tool is denied; the processor records the reason on the execution.
 */
export async function resolveUserPermissions(
  prisma: MembershipReader,
  organizationId: string,
  userId: string,
): Promise<ResolvedUserPermissions> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, organizationId, organization: { deletedAt: null } },
    select: {
      status: true,
      user: { select: { isActive: true } },
      role: { select: { key: true, isSystem: true, permissions: true } },
    },
  });
  if (!membership) return { permissions: [], membership: 'missing', roleKey: null };
  if (membership.status !== 'active' || !membership.user.isActive) {
    return { permissions: [], membership: 'inactive', roleKey: membership.role.key };
  }
  const isOwner = membership.role.isSystem && membership.role.key === SystemRole.OWNER;
  const permissions = isOwner
    ? [...new Set([...membership.role.permissions, ...ALL_PERMISSIONS])]
    : [...membership.role.permissions];
  return { permissions, membership: 'active', roleKey: membership.role.key };
}
