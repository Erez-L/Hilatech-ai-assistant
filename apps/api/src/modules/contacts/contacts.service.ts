import {
  AuditAction,
  type Contact as ContactDto,
  type ContactDetail,
  type CreateContactRequest,
  type ListContactsQuery,
  type UpdateContactRequest,
} from '@hilatech/contracts';
import { type Prisma } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable, Optional } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CrmReferencesService } from '../crm/crm-references.service';
import { DomainEventsService } from '../events/domain-events.service';
import { USER_SUMMARY_SELECT, toContact, toUserSummary } from '../crm/crm.mappers';

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refs: CrmReferencesService,
    @Optional() private readonly events?: DomainEventsService,
  ) {}

  async list(tenant: TenantContext, query: ListContactsQuery): Promise<PageResult<ContactDto>> {
    const where: Prisma.ContactWhereInput = {
      organizationId: tenant.organizationId,
      deletedAt: null,
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.search ? { OR: searchClauses(query.search) } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.contact.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        ...skipTake(query),
      }),
      this.prisma.client.contact.count({ where }),
    ]);
    return page(rows.map(toContact), query, total);
  }

  async create(
    tenant: TenantContext,
    dto: CreateContactRequest,
    meta: RequestMeta,
  ): Promise<ContactDto> {
    if (dto.ownerId) await this.refs.assertActiveMember(tenant, dto.ownerId, 'ownerId');
    if (dto.companyId) await this.refs.assertCompany(tenant, dto.companyId, 'companyId');
    const contact = await this.prisma.client.contact.create({
      data: {
        organizationId: tenant.organizationId,
        firstName: dto.firstName,
        lastName: dto.lastName ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        company: dto.company ?? null,
        jobTitle: dto.jobTitle ?? null,
        tags: dto.tags,
        notes: dto.notes ?? null,
        customFields: dto.customFields as Prisma.InputJsonObject,
        ownerId: dto.ownerId ?? null,
        companyId: dto.companyId ?? null,
      },
    });
    await this.audit.log({
      action: AuditAction.CONTACT_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'contact',
      targetId: contact.id,
      metadata: { email: contact.email, company: contact.company },
      request: meta,
    });
    await this.events?.emit(
      tenant.organizationId,
      'contact.created',
      {
        contactId: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        company: contact.company,
        ownerId: contact.ownerId,
      },
      { actorUserId: tenant.userId, requestId: meta.requestId },
    );
    return toContact(contact);
  }

  async get(tenant: TenantContext, id: string): Promise<ContactDetail> {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id, organizationId: tenant.organizationId, deletedAt: null },
      include: {
        owner: { select: USER_SUMMARY_SELECT },
        _count: { select: { leads: { where: { deletedAt: null } }, conversations: true } },
      },
    });
    if (!contact) throw AppException.notFound('Contact');
    return {
      ...toContact(contact),
      owner: toUserSummary(contact.owner),
      leadCount: contact._count.leads,
      conversationCount: contact._count.conversations,
    };
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateContactRequest,
    meta: RequestMeta,
  ): Promise<ContactDto> {
    const existing = await this.requireContact(tenant, id);
    if (dto.ownerId !== undefined && dto.ownerId !== existing.ownerId) {
      await this.refs.assertActiveMember(tenant, dto.ownerId, 'ownerId');
    }
    if (dto.companyId) await this.refs.assertCompany(tenant, dto.companyId, 'companyId');
    const data: Prisma.ContactUncheckedUpdateInput = {};
    if (dto.companyId !== undefined) data.companyId = dto.companyId;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.company !== undefined) data.company = dto.company;
    if (dto.jobTitle !== undefined) data.jobTitle = dto.jobTitle;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.customFields !== undefined)
      data.customFields = dto.customFields as Prisma.InputJsonObject;
    if (dto.ownerId !== undefined) data.ownerId = dto.ownerId;

    if (Object.keys(data).length === 0) return toContact(existing);

    const updated = await this.prisma.client.contact.update({ where: { id: existing.id }, data });
    await this.audit.log({
      action: AuditAction.CONTACT_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'contact',
      targetId: existing.id,
      metadata: { changes: Object.keys(data) },
      request: meta,
    });
    return toContact(updated);
  }

  /** Soft delete: the row stays for leads/conversations that reference it but leaves every listing. */
  async softDelete(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const result = await this.prisma.client.contact.updateMany({
      where: { id, organizationId: tenant.organizationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw AppException.notFound('Contact');
    await this.audit.log({
      action: AuditAction.CONTACT_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'contact',
      targetId: id,
      request: meta,
    });
  }

  /** Distinct tags used by the organization's (non-deleted) contacts, alphabetically. */
  async tags(tenant: TenantContext): Promise<string[]> {
    const rows = await this.prisma.client.$queryRaw<Array<{ tag: string }>>`
      SELECT DISTINCT unnest("tags") AS tag
      FROM "Contact"
      WHERE "organizationId" = ${tenant.organizationId}::uuid AND "deletedAt" IS NULL
      ORDER BY tag ASC`;
    return rows.map((r) => r.tag);
  }

  private async requireContact(tenant: TenantContext, id: string) {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id, organizationId: tenant.organizationId, deletedAt: null },
    });
    if (!contact) throw AppException.notFound('Contact');
    return contact;
  }
}

/** Case-insensitive `contains` over the searchable contact columns. */
export function searchClauses(search: string): Prisma.ContactWhereInput[] {
  const contains = { contains: search, mode: 'insensitive' as const };
  return [
    { firstName: contains },
    { lastName: contains },
    { email: contains },
    { company: contains },
    { phone: contains },
  ];
}
