import {
  type Invitation as InvitationDto,
  type Member as MemberDto,
  type Organization as OrganizationDto,
  type OrganizationSettings,
  type Role as RoleDto,
  organizationSettingsSchema,
} from '@hilatech/contracts';
import {
  type Invitation,
  type Organization,
  type OrganizationMember,
  type Role,
  type User,
} from '@hilatech/database';

export function parseSettings(value: unknown): OrganizationSettings {
  const parsed = organizationSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

export function toOrganization(org: Organization): OrganizationDto {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    industry: org.industry,
    timezone: org.timezone,
    locale: org.locale,
    logoUrl: org.logoUrl,
    website: org.website,
    description: org.description,
    settings: parseSettings(org.settings),
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

export function toRole(role: Role): RoleDto {
  return {
    id: role.id,
    organizationId: role.organizationId,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

export type MemberRow = OrganizationMember & {
  role: Pick<Role, 'id' | 'key' | 'name' | 'isSystem'>;
  user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'avatarUrl'>;
};

export function toMember(member: MemberRow): MemberDto {
  return {
    id: member.id,
    organizationId: member.organizationId,
    userId: member.userId,
    status: member.status,
    role: {
      id: member.role.id,
      key: member.role.key,
      name: member.role.name,
      isSystem: member.role.isSystem,
    },
    user: {
      id: member.user.id,
      email: member.user.email,
      firstName: member.user.firstName,
      lastName: member.user.lastName,
      avatarUrl: member.user.avatarUrl,
    },
    joinedAt: member.joinedAt.toISOString(),
  };
}

export type InvitationRow = Invitation & {
  role: Pick<Role, 'id' | 'key' | 'name'>;
  invitedBy: Pick<User, 'id' | 'firstName' | 'lastName'>;
};

export function toInvitation(inv: InvitationRow): InvitationDto {
  return {
    id: inv.id,
    organizationId: inv.organizationId,
    email: inv.email,
    role: { id: inv.role.id, key: inv.role.key, name: inv.role.name },
    status: inv.status,
    invitedBy: {
      id: inv.invitedBy.id,
      firstName: inv.invitedBy.firstName,
      lastName: inv.invitedBy.lastName,
    },
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
  };
}

export const MEMBER_INCLUDE = {
  role: { select: { id: true, key: true, name: true, isSystem: true } },
  user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } },
} as const;

export const INVITATION_INCLUDE = {
  role: { select: { id: true, key: true, name: true } },
  invitedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;
