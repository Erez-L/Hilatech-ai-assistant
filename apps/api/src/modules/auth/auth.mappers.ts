import { type AuthUser, type OrganizationSummary } from '@hilatech/contracts';
import {
  type Organization,
  type OrganizationMember,
  type Role,
  type User,
} from '@hilatech/database';

export type MembershipWithOrgAndRole = OrganizationMember & {
  organization: Organization;
  role: Role;
};

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toOrganizationSummary(membership: MembershipWithOrgAndRole): OrganizationSummary {
  return {
    id: membership.organization.id,
    name: membership.organization.name,
    slug: membership.organization.slug,
    logoUrl: membership.organization.logoUrl,
    roleKey: membership.role.key,
    roleName: membership.role.name,
  };
}
