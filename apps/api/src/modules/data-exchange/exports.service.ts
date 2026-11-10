import {
  AuditAction,
  EXPORT_COLUMNS,
  type ExportCompaniesQuery,
  type ExportContactsQuery,
  type ExportDealsQuery,
  type ExportLeadsQuery,
  type ExportTasksQuery,
} from '@hilatech/contracts';
import { type Prisma } from '@hilatech/database';
import { UTF8_BOM, csvLine } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';

import { type RequestMeta } from '../../common/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { companySearchClauses } from '../companies/companies.service';
import { searchClauses as contactSearchClauses } from '../contacts/contacts.service';
import { decimalToNumber } from '../crm/crm.mappers';
import { buildDealWhere } from '../deals/deals.service';
import { searchClauses as leadSearchClauses } from '../leads/leads.service';
import { buildTaskWhere } from '../tasks/tasks.service';

/** Rows per database round trip (keyset batches; memory stays flat regardless of the export size). */
export const EXPORT_BATCH_SIZE = 500;
/** Hard cap per export so one request cannot read an unbounded table. */
export const EXPORT_MAX_ROWS = 100_000;

type Cell = string | number | boolean | null | undefined;
type ExportEntity = 'contacts' | 'leads' | 'companies' | 'deals' | 'tasks';

export interface ExportStream {
  stream: Readable;
  fileName: string;
}

const iso = (d: Date | null | undefined): string => (d ? d.toISOString() : '');
const tags = (t: string[]): string => t.join(';');

export const TASK_EXPORT_COLUMNS = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'dueAt',
  'reminderAt',
  'completedAt',
  'assigneeEmail',
  'source',
  'leadId',
  'contactId',
  'dealId',
  'createdAt',
] as const;

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  contacts(tenant: TenantContext, query: ExportContactsQuery, meta: RequestMeta): ExportStream {
    const db = this.prisma.client;
    const where: Prisma.ContactWhereInput = {
      organizationId: tenant.organizationId,
      deletedAt: null,
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.search ? { OR: contactSearchClauses(query.search) } : {}),
    };
    return this.build(tenant, meta, 'contacts', EXPORT_COLUMNS.contacts, query, async (cursor) => {
      const rows = await db.contact.findMany({
        where,
        include: { owner: { select: { email: true } } },
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      return rows.map((r) => ({
        id: r.id,
        cells: [
          r.id,
          r.firstName,
          r.lastName,
          r.email,
          r.phone,
          r.company,
          r.jobTitle,
          tags(r.tags),
          r.notes,
          r.owner?.email,
          iso(r.createdAt),
        ],
      }));
    });
  }

  leads(tenant: TenantContext, query: ExportLeadsQuery, meta: RequestMeta): ExportStream {
    const db = this.prisma.client;
    const where: Prisma.LeadWhereInput = {
      organizationId: tenant.organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.search ? { OR: leadSearchClauses(query.search) } : {}),
    };
    const sort: Prisma.LeadOrderByWithRelationInput =
      query.sortBy === 'value' || query.sortBy === 'expectedCloseDate'
        ? { [query.sortBy]: { sort: query.sortOrder, nulls: 'last' } }
        : { [query.sortBy]: query.sortOrder };
    return this.build(tenant, meta, 'leads', EXPORT_COLUMNS.leads, query, async (cursor) => {
      const rows = await db.lead.findMany({
        where,
        include: {
          contact: { select: { email: true, phone: true } },
          assignee: { select: { email: true } },
        },
        orderBy: [sort, { id: 'asc' }],
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      return rows.map((r) => ({
        id: r.id,
        cells: [
          r.id,
          r.title,
          r.status,
          r.source,
          decimalToNumber(r.value),
          r.currency,
          r.contact?.email,
          r.contact?.phone,
          r.assignee?.email,
          r.description,
          tags(r.tags),
          iso(r.expectedCloseDate),
          iso(r.createdAt),
        ],
      }));
    });
  }

  companies(tenant: TenantContext, query: ExportCompaniesQuery, meta: RequestMeta): ExportStream {
    const db = this.prisma.client;
    const where: Prisma.CompanyWhereInput = {
      organizationId: tenant.organizationId,
      ...(query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.search ? { OR: companySearchClauses(query.search) } : {}),
    };
    return this.build(tenant, meta, 'companies', EXPORT_COLUMNS.companies, query, async (cursor) => {
      const rows = await db.company.findMany({
        where,
        include: { owner: { select: { email: true } } },
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }],
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      return rows.map((r) => ({
        id: r.id,
        cells: [r.id, r.name, r.domain, r.notes, tags(r.tags), r.owner?.email, iso(r.createdAt)],
      }));
    });
  }

  deals(tenant: TenantContext, query: ExportDealsQuery, meta: RequestMeta): ExportStream {
    const db = this.prisma.client;
    const where = buildDealWhere(tenant, query);
    const sort: Prisma.DealOrderByWithRelationInput =
      query.sortBy === 'value' || query.sortBy === 'expectedCloseAt'
        ? { [query.sortBy]: { sort: query.sortOrder, nulls: 'last' } }
        : { [query.sortBy]: query.sortOrder };
    return this.build(tenant, meta, 'deals', EXPORT_COLUMNS.deals, query, async (cursor) => {
      const rows = await db.deal.findMany({
        where,
        include: {
          pipeline: { select: { name: true } },
          stage: { select: { name: true } },
          owner: { select: { email: true } },
          contact: { select: { email: true } },
          company: { select: { name: true } },
        },
        orderBy: [sort, { id: 'asc' }],
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      return rows.map((r) => ({
        id: r.id,
        cells: [
          r.id,
          r.title,
          decimalToNumber(r.value),
          r.currency,
          r.pipeline.name,
          r.stage.name,
          r.status,
          r.owner?.email,
          r.contact?.email,
          r.company?.name,
          iso(r.expectedCloseAt),
          iso(r.closedAt),
          r.lostReason,
          r.description,
          tags(r.tags),
          iso(r.createdAt),
        ],
      }));
    });
  }

  tasks(tenant: TenantContext, query: ExportTasksQuery, meta: RequestMeta): ExportStream {
    const db = this.prisma.client;
    const where = buildTaskWhere(tenant, { ...query }, new Date());
    return this.build(tenant, meta, 'tasks', TASK_EXPORT_COLUMNS, query, async (cursor) => {
      const rows = await db.task.findMany({
        where,
        include: { assignee: { select: { email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      return rows.map((r) => ({
        id: r.id,
        cells: [
          r.id,
          r.title,
          r.description,
          r.status,
          r.priority,
          iso(r.dueAt),
          iso(r.reminderAt),
          iso(r.completedAt),
          r.assignee?.email,
          r.source,
          r.leadId,
          r.contactId,
          r.dealId,
          iso(r.createdAt),
        ],
      }));
    });
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * Streams `BOM + header + rows` batch by batch (keyset cursor on the stable `[sort, id]` order). Every cell goes
   * through `csvCell` (formula-injection safe). The audit entry is written when the stream ends, with the real row
   * count (also when the client aborts).
   */
  private build(
    tenant: TenantContext,
    meta: RequestMeta,
    entity: ExportEntity,
    columns: readonly string[],
    filters: object,
    fetchBatch: (cursor: string | null) => Promise<Array<{ id: string; cells: Cell[] }>>,
  ): ExportStream {
    const audit = this.audit;
    async function* generate(): AsyncGenerator<string> {
      let rows = 0;
      let completed = false;
      try {
        yield UTF8_BOM + csvLine(columns);
        let cursor: string | null = null;
        while (rows < EXPORT_MAX_ROWS) {
          const batch = await fetchBatch(cursor);
          if (batch.length === 0) break;
          const room = EXPORT_MAX_ROWS - rows;
          const slice = batch.length > room ? batch.slice(0, room) : batch;
          yield slice.map((r) => csvLine(r.cells)).join('');
          rows += slice.length;
          cursor = batch[batch.length - 1]?.id ?? null;
          if (batch.length < EXPORT_BATCH_SIZE) break;
        }
        completed = true;
      } finally {
        await audit
          .log({
            action: AuditAction.DATA_EXPORTED,
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            targetType: entity,
            metadata: { entity, rows, completed, filters, capped: rows >= EXPORT_MAX_ROWS },
            request: meta,
          })
          .catch(() => undefined);
      }
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return { stream: Readable.from(generate()), fileName: `${entity}-${stamp}.csv` };
  }
}
