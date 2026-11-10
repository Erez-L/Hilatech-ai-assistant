import {
  ALL_PERMISSIONS,
  AuditAction,
  type CreateRoleRequest,
  type Role as RoleDto,
  SystemRole,
  type UpdateRoleRequest,
  isPermission,
} from '@hilatech/contracts';
import { type Role } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PrivilegeRules } from './member.rules';
import { toRole } from './organizations.mappers';

/**
 * Permission catalog entry (mirrors the `Permission` table).
 * TODO(contracts): add `permissionCatalogEntrySchema` to `@hilatech/contracts`.
 */
export interface PermissionCatalogEntry {
  key: string;
  group: string;
  description: string | null;
}

const SYSTEM_KEYS: readonly string[] = Object.values(SystemRole);

/** Pure invariants, exported for unit tests. */
export const RoleRules = {
  /** Unknown permission keys are rejected (400 with the offending keys). */
  assertKnownPermissions(permissions: string[]): void {
    const unknown = permissions.filter((p) => !isPermission(p));
    if (unknown.length > 0) {
      throw AppException.validation(
        'Unknown permission keys',
        unknown.map((key) => ({
          path: 'permissions',
          message: `Unknown permission "${key}"`,
          code: 'custom',
        })),
      );
    }
  },
  /** The owner role must keep every permission (ADR-006). */
  assertOwnerNotReduced(role: Pick<Role, 'key' | 'isSystem'>, nextPermissions: string[]): void {
    if (!(role.isSystem && role.key === SystemRole.OWNER)) return;
    const next = new Set(nextPermissions);
    const removed = ALL_PERMISSIONS.filter((p) => !next.has(p));
    if (removed.length > 0) {
      throw AppException.forbidden('Owner permissions cannot be reduced', { removed });
    }
  },
  assertNotSystemKey(key: string): void {
    if (SYSTEM_KEYS.includes(key)) {
      throw AppException.conflict(`"${key}" is reserved for a system role`);
    }
  },
  assertRenameAllowed(role: Pick<Role, 'isSystem' | 'name'>, dto: UpdateRoleRequest): void {
    if (role.isSystem && dto.name !== undefined && dto.name !== role.name) {
      throw AppException.forbidden('System roles cannot be renamed');
    }
  },
  assertDeletable(
    role: Pick<Role, 'isSystem'>,
    memberCount: number,
    pendingInvitations: number,
  ): void {
    if (role.isSystem) throw AppException.forbidden('System roles cannot be deleted');
    if (memberCount > 0) {
      throw AppException.conflict('This role is assigned to members; reassign them first', {
        memberCount,
      });
    }
    if (pendingInvitations > 0) {
      throw AppException.conflict('This role is used by pending invitations; revoke them first', {
        pendingInvitations,
      });
    }
  },
};

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async permissionCatalog(): Promise<PermissionCatalogEntry[]> {
    const rows = await this.prisma.client.permission.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });
    if (rows.length > 0) {
      return rows.map((r) => ({ key: r.key, group: r.group, description: r.description }));
    }
    // Catalog table not seeded yet: the contracts package is the source of truth it mirrors.
    return ALL_PERMISSIONS.map((key) => ({
      key,
      group: key.split(':')[0] ?? 'misc',
      description: null,
    }));
  }

  async list(tenant: TenantContext): Promise<RoleDto[]> {
    const roles = await this.prisma.client.role.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    });
    return roles.map(toRole);
  }

  async get(tenant: TenantContext, roleId: string): Promise<RoleDto> {
    return toRole(await this.requireRole(tenant, roleId));
  }

  async create(tenant: TenantContext, dto: CreateRoleRequest, meta: RequestMeta): Promise<RoleDto> {
    RoleRules.assertNotSystemKey(dto.key);
    RoleRules.assertKnownPermissions(dto.permissions);
    PrivilegeRules.assertNoEscalation(tenant.permissions, dto.permissions, 'create');
    const exists = await this.prisma.client.role.findUnique({
      where: { organizationId_key: { organizationId: tenant.organizationId, key: dto.key } },
      select: { id: true },
    });
    if (exists) throw AppException.conflict(`A role with key "${dto.key}" already exists`);

    const role = await this.prisma.client.role.create({
      data: {
        organizationId: tenant.organizationId,
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        isSystem: false,
        permissions: [...new Set(dto.permissions)],
      },
    });
    await this.audit.log({
      action: AuditAction.ROLE_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'role',
      targetId: role.id,
      metadata: { key: role.key, permissions: role.permissions },
      request: meta,
    });
    return toRole(role);
  }

  async update(
    tenant: TenantContext,
    roleId: string,
    dto: UpdateRoleRequest,
    meta: RequestMeta,
  ): Promise<RoleDto> {
    const role = await this.requireRole(tenant, roleId);
    RoleRules.assertRenameAllowed(role, dto);
    if (dto.permissions !== undefined) {
      RoleRules.assertKnownPermissions(dto.permissions);
      // Neither grant permissions you lack, nor rewrite a role that is more powerful than you.
      PrivilegeRules.assertNoEscalation(tenant.permissions, dto.permissions, 'grant');
      PrivilegeRules.assertNoEscalation(tenant.permissions, role.permissions, 'modify');
      RoleRules.assertOwnerNotReduced(role, dto.permissions);
    }

    const updated = await this.prisma.client.role.update({
      where: { id: role.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.permissions !== undefined ? { permissions: [...new Set(dto.permissions)] } : {}),
      },
    });
    await this.audit.log({
      action: AuditAction.ROLE_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'role',
      targetId: role.id,
      metadata: { changes: Object.keys(dto) },
      request: meta,
    });
    return toRole(updated);
  }

  async remove(tenant: TenantContext, roleId: string, meta: RequestMeta): Promise<void> {
    const role = await this.requireRole(tenant, roleId);
    const [memberCount, pendingInvitations] = await Promise.all([
      this.prisma.client.organizationMember.count({
        where: { roleId: role.id, organizationId: tenant.organizationId },
      }),
      this.prisma.client.invitation.count({
        where: { roleId: role.id, organizationId: tenant.organizationId, status: 'pending' },
      }),
    ]);
    RoleRules.assertDeletable(role, memberCount, pendingInvitations);

    await this.prisma.client.$transaction([
      // Historical (non-pending) invitations reference the role with ON DELETE RESTRICT; the audit log keeps the history.
      this.prisma.client.invitation.deleteMany({
        where: { roleId: role.id, organizationId: tenant.organizationId },
      }),
      this.prisma.client.role.delete({ where: { id: role.id } }),
    ]);
    await this.audit.log({
      action: AuditAction.ROLE_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'role',
      targetId: role.id,
      metadata: { key: role.key, name: role.name },
      request: meta,
    });
  }

  /** Loads a role that must belong to the tenant's organization (404 otherwise — never leaks foreign roles). */
  async requireRole(tenant: TenantContext, roleId: string): Promise<Role> {
    const role = await this.prisma.client.role.findFirst({
      where: { id: roleId, organizationId: tenant.organizationId },
    });
    if (!role) throw AppException.notFound('Role');
    return role;
  }
}
