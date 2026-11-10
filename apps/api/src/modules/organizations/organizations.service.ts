import {
  AuditAction,
  type CreateOrganizationRequest,
  type Organization as OrganizationDto,
  type OrganizationSettings,
  type OrganizationSummary,
  PLAN_LIMITS,
  SYSTEM_ROLE_PERMISSIONS,
  SystemRole,
  type UpdateOrganizationRequest,
} from '@hilatech/contracts';
import { type Prisma, createDefaultPipeline } from '@hilatech/database';
import { slugify, withRandomSuffix } from '@hilatech/shared';
import { type Principal, type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toOrganizationSummary } from '../auth/auth.mappers';
import { parseSettings, toOrganization } from './organizations.mappers';

const SYSTEM_ROLE_NAMES: Record<SystemRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};
const MAX_SLUG_ATTEMPTS = 5;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates an organization with its three system roles, the creator as owner and a free subscription,
   * all in one transaction.
   */
  async create(
    principal: Principal,
    dto: CreateOrganizationRequest,
    meta: RequestMeta,
  ): Promise<OrganizationDto> {
    const slug = await this.resolveSlug(dto.slug, dto.name);
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    const org = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: dto.name,
          slug,
          industry: dto.industry ?? null,
          timezone: dto.timezone,
          locale: dto.locale,
          settings: {},
        },
      });
      const roles = await Promise.all(
        (Object.values(SystemRole) as SystemRole[]).map((key) =>
          tx.role.create({
            data: {
              organizationId: created.id,
              key,
              name: SYSTEM_ROLE_NAMES[key],
              isSystem: true,
              permissions: [...SYSTEM_ROLE_PERMISSIONS[key]],
            },
          }),
        ),
      );
      const ownerRole = roles.find((r) => r.key === SystemRole.OWNER);
      if (!ownerRole) throw new Error('Owner role was not created');
      await tx.organizationMember.create({
        data: {
          organizationId: created.id,
          userId: principal.userId,
          roleId: ownerRole.id,
          status: 'active',
        },
      });
      await tx.subscription.create({
        data: {
          organizationId: created.id,
          plan: 'free',
          status: 'active',
          limits: PLAN_LIMITS.free,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
      await createDefaultPipeline(tx, created.id);
      return created;
    });

    await this.audit.log({
      action: AuditAction.ORG_CREATED,
      organizationId: org.id,
      actorUserId: principal.userId,
      targetType: 'organization',
      targetId: org.id,
      metadata: { name: org.name, slug: org.slug },
      request: meta,
    });
    return toOrganization(org);
  }

  /** The caller's active memberships in non-deleted organizations. */
  async listForUser(userId: string): Promise<OrganizationSummary[]> {
    const memberships = await this.prisma.client.organizationMember.findMany({
      where: { userId, status: 'active', organization: { deletedAt: null } },
      include: { organization: true, role: true },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map(toOrganizationSummary);
  }

  async getCurrent(tenant: TenantContext): Promise<OrganizationDto> {
    const org = await this.prisma.client.organization.findFirst({
      where: { id: tenant.organizationId, deletedAt: null },
    });
    if (!org) throw AppException.notFound('Organization');
    return toOrganization(org);
  }

  async update(
    tenant: TenantContext,
    dto: UpdateOrganizationRequest,
    meta: RequestMeta,
  ): Promise<OrganizationDto> {
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.industry !== undefined) data.industry = dto.industry;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.locale !== undefined) data.locale = dto.locale;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
    if (dto.website !== undefined) data.website = dto.website;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.slug !== undefined) {
      const taken = await this.prisma.client.organization.findFirst({
        where: { slug: dto.slug, NOT: { id: tenant.organizationId } },
        select: { id: true },
      });
      if (taken) throw AppException.conflict('This slug is already in use');
      data.slug = dto.slug;
    }

    const result = await this.prisma.client.organization.updateMany({
      where: { id: tenant.organizationId, deletedAt: null },
      data,
    });
    if (result.count === 0) throw AppException.notFound('Organization');
    const org = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: tenant.organizationId },
    });

    await this.audit.log({
      action: AuditAction.ORG_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'organization',
      targetId: tenant.organizationId,
      metadata: { changes: Object.keys(data) },
      request: meta,
    });
    return toOrganization(org);
  }

  /** Soft delete. Restricted to the owner role in addition to the ORG_DELETE permission. */
  async softDelete(tenant: TenantContext, meta: RequestMeta): Promise<void> {
    if (tenant.roleKey !== SystemRole.OWNER) {
      throw AppException.forbidden('Only an owner can delete the organization');
    }
    const result = await this.prisma.client.organization.updateMany({
      where: { id: tenant.organizationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw AppException.notFound('Organization');
    await this.audit.log({
      action: AuditAction.ORG_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'organization',
      targetId: tenant.organizationId,
      request: meta,
    });
  }

  async getSettings(tenant: TenantContext): Promise<OrganizationSettings> {
    const org = await this.prisma.client.organization.findFirst({
      where: { id: tenant.organizationId, deletedAt: null },
      select: { settings: true },
    });
    if (!org) throw AppException.notFound('Organization');
    return parseSettings(org.settings);
  }

  /** Full replacement of the validated settings document. */
  async replaceSettings(
    tenant: TenantContext,
    settings: OrganizationSettings,
    meta: RequestMeta,
  ): Promise<OrganizationSettings> {
    const result = await this.prisma.client.organization.updateMany({
      where: { id: tenant.organizationId, deletedAt: null },
      data: { settings: settings as Prisma.InputJsonObject },
    });
    if (result.count === 0) throw AppException.notFound('Organization');
    await this.audit.log({
      action: AuditAction.ORG_SETTINGS_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'organization',
      targetId: tenant.organizationId,
      metadata: { keys: Object.keys(settings) },
      request: meta,
    });
    return settings;
  }

  private async resolveSlug(requested: string | undefined, name: string): Promise<string> {
    if (requested) {
      const taken = await this.prisma.client.organization.findUnique({
        where: { slug: requested },
        select: { id: true },
      });
      if (taken) throw AppException.conflict('This slug is already in use');
      return requested;
    }
    const base = slugify(name);
    let candidate = base.length >= 3 ? base : withRandomSuffix(base);
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const taken = await this.prisma.client.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
      candidate = withRandomSuffix(base, attempt < 2 ? 4 : 6);
    }
    throw AppException.conflict('Could not allocate a unique slug, please provide one');
  }
}
