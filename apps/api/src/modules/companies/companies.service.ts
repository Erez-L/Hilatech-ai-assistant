import {
  type AssociateContactsRequest,
  type AssociateContactsResult,
  AuditAction,
  type Company as CompanyDto,
  type CompanyDetail,
  type Contact as ContactDto,
  type CreateCompanyRequest,
  type ListCompaniesQuery,
  type PaginationQuery,
  type UpdateCompanyRequest,
} from '@hilatech/contracts';
import { type Company, type Prisma } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CrmReferencesService } from '../crm/crm-references.service';
import { USER_SUMMARY_SELECT, toContact, toUserSummary } from '../crm/crm.mappers';

export function toCompany(row: Company): CompanyDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    domain: row.domain,
    notes: row.notes,
    tags: row.tags,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function companySearchClauses(search: string): Prisma.CompanyWhereInput[] {
  const contains = { contains: search, mode: 'insensitive' as const };
  return [{ name: contains }, { domain: contains }];
}

export function buildCompanyWhere(
  organizationId: string,
  query: Partial<ListCompaniesQuery>,
): Prisma.CompanyWhereInput {
  return {
    organizationId,
    ...(query.ownerId ? { ownerId: query.ownerId } : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    ...(query.search ? { OR: companySearchClauses(query.search) } : {}),
  };
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refs: CrmReferencesService,
  ) {}

  async list(tenant: TenantContext, query: ListCompaniesQuery): Promise<PageResult<CompanyDto>> {
    const where = buildCompanyWhere(tenant.organizationId, query);
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.company.findMany({
        where,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.client.company.count({ where }),
    ]);
    return page(rows.map(toCompany), query, total);
  }

  async create(
    tenant: TenantContext,
    dto: CreateCompanyRequest,
    meta: RequestMeta,
  ): Promise<CompanyDto> {
    if (dto.ownerId) await this.refs.assertActiveMember(tenant, dto.ownerId, 'ownerId');
    const company = await this.prisma.client.company.create({
      data: {
        organizationId: tenant.organizationId,
        name: dto.name,
        domain: dto.domain ?? null,
        notes: dto.notes ?? null,
        tags: dto.tags,
        ownerId: dto.ownerId ?? null,
      },
    });
    await this.audit.log({
      action: AuditAction.COMPANY_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'company',
      targetId: company.id,
      metadata: { name: company.name, domain: company.domain },
      request: meta,
    });
    return toCompany(company);
  }

  async get(tenant: TenantContext, id: string): Promise<CompanyDetail> {
    const company = await this.prisma.client.company.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: {
        owner: { select: USER_SUMMARY_SELECT },
        _count: { select: { contacts: { where: { deletedAt: null } }, deals: true } },
      },
    });
    if (!company) throw AppException.notFound('Company');
    return {
      ...toCompany(company),
      owner: toUserSummary(company.owner),
      contactCount: company._count.contacts,
      dealCount: company._count.deals,
    };
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateCompanyRequest,
    meta: RequestMeta,
  ): Promise<CompanyDto> {
    const existing = await this.require(tenant, id);
    if (dto.ownerId) await this.refs.assertActiveMember(tenant, dto.ownerId, 'ownerId');
    const data: Prisma.CompanyUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.domain !== undefined) data.domain = dto.domain;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.ownerId !== undefined) data.ownerId = dto.ownerId;
    if (Object.keys(data).length === 0) return toCompany(existing);
    const updated = await this.prisma.client.company.update({ where: { id: existing.id }, data });
    await this.audit.log({
      action: AuditAction.COMPANY_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'company',
      targetId: existing.id,
      metadata: { changes: Object.keys(data) },
      request: meta,
    });
    return toCompany(updated);
  }

  /** Hard delete: contacts and deals that referenced the company keep existing and lose the link. */
  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const result = await this.prisma.client.company.deleteMany({
      where: { id, organizationId: tenant.organizationId },
    });
    if (result.count === 0) throw AppException.notFound('Company');
    await this.audit.log({
      action: AuditAction.COMPANY_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'company',
      targetId: id,
      request: meta,
    });
  }

  async listContacts(
    tenant: TenantContext,
    id: string,
    query: PaginationQuery,
  ): Promise<PageResult<ContactDto>> {
    await this.require(tenant, id);
    const where = { organizationId: tenant.organizationId, companyId: id, deletedAt: null };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.contact.findMany({
        where,
        orderBy: [{ firstName: 'asc' }, { id: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.client.contact.count({ where }),
    ]);
    return page(rows.map(toContact), query, total);
  }

  /** Links existing contacts of the organization to the company (also fills the free-text `company` when empty). */
  async associateContacts(
    tenant: TenantContext,
    id: string,
    dto: AssociateContactsRequest,
    meta: RequestMeta,
  ): Promise<AssociateContactsResult> {
    const company = await this.require(tenant, id);
    const ids = [...new Set(dto.contactIds)];
    const found = await this.prisma.client.contact.findMany({
      where: { id: { in: ids }, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true, company: true },
    });
    const foundIds = new Set(found.map((c) => c.id));
    if (found.length > 0) {
      await this.prisma.client.contact.updateMany({
        where: { id: { in: [...foundIds] }, organizationId: tenant.organizationId },
        data: { companyId: company.id },
      });
      await this.prisma.client.contact.updateMany({
        where: {
          id: { in: found.filter((c) => !c.company).map((c) => c.id) },
          organizationId: tenant.organizationId,
        },
        data: { company: company.name.slice(0, 120) },
      });
      await this.audit.log({
        action: AuditAction.COMPANY_UPDATED,
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        targetType: 'company',
        targetId: company.id,
        metadata: { kind: 'contacts_associated', contactIds: [...foundIds].slice(0, 100) },
        request: meta,
      });
    }
    return { associated: foundIds.size, notFound: ids.filter((c) => !foundIds.has(c)) };
  }

  async dissociateContact(
    tenant: TenantContext,
    id: string,
    contactId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.require(tenant, id);
    const result = await this.prisma.client.contact.updateMany({
      where: {
        id: contactId,
        organizationId: tenant.organizationId,
        companyId: id,
        deletedAt: null,
      },
      data: { companyId: null },
    });
    if (result.count === 0) throw AppException.notFound('Contact');
    await this.audit.log({
      action: AuditAction.COMPANY_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'company',
      targetId: id,
      metadata: { kind: 'contact_removed', contactId },
      request: meta,
    });
  }

  private async require(tenant: TenantContext, id: string): Promise<Company> {
    const company = await this.prisma.client.company.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!company) throw AppException.notFound('Company');
    return company;
  }
}
