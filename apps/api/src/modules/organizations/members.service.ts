import {
  AuditAction,
  type Member as MemberDto,
  type PaginationQuery,
  type UpdateMemberRequest,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MemberRules, PrivilegeRules, type MemberRuleContext } from './member.rules';
import { MEMBER_INCLUDE, toMember } from './organizations.mappers';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext, query: PaginationQuery): Promise<PageResult<MemberDto>> {
    const where = { organizationId: tenant.organizationId };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.organizationMember.findMany({
        where,
        include: MEMBER_INCLUDE,
        orderBy: { joinedAt: 'asc' },
        ...skipTake(query),
      }),
      this.prisma.client.organizationMember.count({ where }),
    ]);
    return page(rows.map(toMember), query, total);
  }

  async update(
    tenant: TenantContext,
    memberId: string,
    dto: UpdateMemberRequest,
    meta: RequestMeta,
  ): Promise<MemberDto> {
    const member = await this.requireMember(tenant, memberId);
    await this.assertOutranks(tenant, member);
    const ctx = await this.ruleContext(tenant, member);
    const data: { roleId?: string; status?: 'active' | 'suspended' } = {};

    if (dto.roleId !== undefined && dto.roleId !== member.roleId) {
      const newRole = await this.prisma.client.role.findFirst({
        where: { id: dto.roleId, organizationId: tenant.organizationId },
        select: { id: true, key: true, permissions: true },
      });
      if (!newRole) {
        throw AppException.validation('Role not found in this organization', [
          { path: 'roleId', message: 'Unknown role', code: 'custom' },
        ]);
      }
      MemberRules.assertCanAssignRole(ctx, MemberRules.isOwnerKey(newRole.key));
      PrivilegeRules.assertNoEscalation(tenant.permissions, newRole.permissions, 'assign');
      data.roleId = newRole.id;
    }

    if (dto.status !== undefined && dto.status !== member.status) {
      MemberRules.assertCanChangeStatus(ctx, dto.status);
      data.status = dto.status;
    }

    if (Object.keys(data).length === 0) return toMember(member);

    const updated = await this.prisma.client.organizationMember.update({
      where: { id: member.id },
      data,
      include: MEMBER_INCLUDE,
    });
    await this.audit.log({
      action: AuditAction.MEMBER_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'member',
      targetId: member.id,
      metadata: {
        userId: member.userId,
        changes: data,
        previous: { roleId: member.roleId, status: member.status },
      },
      request: meta,
    });
    return toMember(updated);
  }

  async remove(tenant: TenantContext, memberId: string, meta: RequestMeta): Promise<void> {
    const member = await this.requireMember(tenant, memberId);
    await this.assertOutranks(tenant, member);
    const ctx = await this.ruleContext(tenant, member);
    MemberRules.assertCanRemove(ctx);

    await this.prisma.client.organizationMember.delete({ where: { id: member.id } });
    await this.audit.log({
      action: AuditAction.MEMBER_REMOVED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'member',
      targetId: member.id,
      metadata: { userId: member.userId, roleKey: member.role.key },
      request: meta,
    });
  }

  /** The caller leaves the organization (no permission required beyond membership). */
  async leave(tenant: TenantContext, meta: RequestMeta): Promise<void> {
    const member = await this.requireMember(tenant, tenant.memberId);
    const ctx = await this.ruleContext(tenant, member);
    MemberRules.assertCanLeave(ctx);

    await this.prisma.client.organizationMember.delete({ where: { id: member.id } });
    await this.audit.log({
      action: AuditAction.MEMBER_REMOVED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'member',
      targetId: member.id,
      metadata: { userId: member.userId, roleKey: member.role.key, left: true },
      request: meta,
    });
  }

  private async requireMember(tenant: TenantContext, memberId: string) {
    const member = await this.prisma.client.organizationMember.findFirst({
      where: { id: memberId, organizationId: tenant.organizationId },
      include: MEMBER_INCLUDE,
    });
    if (!member) throw AppException.notFound('Member');
    return member;
  }

  /** A member cannot change or remove someone whose role carries permissions the actor lacks (self excluded). */
  private async assertOutranks(
    tenant: TenantContext,
    member: { userId: string; roleId: string },
  ): Promise<void> {
    if (member.userId === tenant.userId) return;
    const role = await this.prisma.client.role.findUnique({
      where: { id: member.roleId },
      select: { permissions: true },
    });
    PrivilegeRules.assertNoEscalation(tenant.permissions, role?.permissions ?? [], 'manage a member holding');
  }

  private async ruleContext(
    tenant: TenantContext,
    member: { id: string; userId: string; status: 'active' | 'suspended'; role: { key: string } },
  ): Promise<MemberRuleContext> {
    const targetIsActiveOwner =
      MemberRules.isOwnerKey(member.role.key) && member.status === 'active';
    const otherActiveOwners = await this.prisma.client.organizationMember.count({
      where: {
        organizationId: tenant.organizationId,
        status: 'active',
        role: { key: 'owner', isSystem: true },
        NOT: { id: member.id },
      },
    });
    return {
      actorIsOwner: MemberRules.isOwnerKey(tenant.roleKey),
      targetIsActiveOwner,
      otherActiveOwners,
      isSelf: member.userId === tenant.userId,
    };
  }
}
