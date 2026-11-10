import {
  AuditAction,
  type BoardColumn,
  type BoardQuery,
  type CreateDealRequest,
  type CurrencyTotal,
  type DealActivityWithActor,
  type DealBoard,
  type DealConversionQuery,
  type DealConversionReport,
  type DealNoteWithAuthor,
  type DealWithRelations,
  type ListDealsQuery,
  type MoveDealRequest,
  type PaginationQuery,
  type UpdateDealRequest,
  effectiveProbability,
  stageConversion,
  weightedValue,
  winRate,
} from '@hilatech/contracts';
import {
  type Deal,
  DomainError,
  Prisma,
  createDealRow,
  ensureDefaultPipeline,
  moveDealRow,
} from '@hilatech/database';
import { truncate } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable, Optional } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CrmReferencesService } from '../crm/crm-references.service';
import { USER_SUMMARY_SELECT, type UserSummaryRow, decimalToNumber } from '../crm/crm.mappers';
import { DomainEventsService } from '../events/domain-events.service';
import {
  DEAL_INCLUDE,
  DEAL_NOTE_INCLUDE,
  type DealRow,
  toDealActivity,
  toDealNote,
  toDealWithRelations,
  toPipeline,
} from './deals.mappers';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const DEFAULT_RANGE_DAYS = 90;

type DealEvent = 'deal.created' | 'deal.stage_changed' | 'deal.won' | 'deal.lost';

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refs: CrmReferencesService,
    @Optional() private readonly events?: DomainEventsService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------------------------

  async list(tenant: TenantContext, query: ListDealsQuery): Promise<PageResult<DealWithRelations>> {
    const where = buildDealWhere(tenant, query);
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.deal.findMany({
        where,
        include: DEAL_INCLUDE,
        orderBy: dealOrderBy(query),
        ...skipTake(query),
      }),
      this.prisma.client.deal.count({ where }),
    ]);
    return page(rows.map(toDealWithRelations), query, total);
  }

  async create(
    tenant: TenantContext,
    dto: CreateDealRequest,
    meta: RequestMeta,
  ): Promise<DealWithRelations> {
    const { pipelineId, stageId } = await this.resolvePipelineAndStage(tenant, dto.pipelineId, dto.stageId);
    if (dto.ownerId) await this.refs.assertActiveMember(tenant, dto.ownerId, 'ownerId');
    if (dto.contactId) await this.refs.assertContact(tenant, dto.contactId, 'contactId');
    if (dto.companyId) await this.refs.assertCompany(tenant, dto.companyId, 'companyId');

    const created = await this.prisma.client.$transaction(async (tx) => {
      const { deal } = await createDealRow(
        tx,
        {
          organizationId: tenant.organizationId,
          title: dto.title,
          description: dto.description ?? null,
          value: dto.value ?? null,
          currency: dto.currency,
          pipelineId,
          stageId,
          ownerId: dto.ownerId ?? null,
          contactId: dto.contactId ?? null,
          companyId: dto.companyId ?? null,
          expectedCloseAt: dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : null,
          tags: dto.tags,
        },
        { actorId: tenant.userId, by: 'human' },
      );
      return tx.deal.findFirstOrThrow({ where: { id: deal.id }, include: DEAL_INCLUDE });
    });
    await this.audit.log({
      action: AuditAction.DEAL_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'deal',
      targetId: created.id,
      metadata: { title: truncate(created.title, 120), pipelineId, stageId, value: decimalToNumber(created.value) },
      request: meta,
    });
    await this.emit(tenant, meta, 'deal.created', dealEventPayload(created));
    if (created.status !== 'open') {
      await this.emit(tenant, meta, created.status === 'won' ? 'deal.won' : 'deal.lost', dealEventPayload(created));
    }
    return toDealWithRelations(created);
  }

  async get(tenant: TenantContext, id: string): Promise<DealWithRelations> {
    return toDealWithRelations(await this.requireDeal(tenant, id));
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateDealRequest,
    meta: RequestMeta,
  ): Promise<DealWithRelations> {
    const existing = await this.requireDeal(tenant, id);
    if (dto.ownerId && dto.ownerId !== existing.ownerId) {
      await this.refs.assertActiveMember(tenant, dto.ownerId, 'ownerId');
    }
    if (dto.contactId && dto.contactId !== existing.contactId) {
      await this.refs.assertContact(tenant, dto.contactId, 'contactId');
    }
    if (dto.companyId && dto.companyId !== existing.companyId) {
      await this.refs.assertCompany(tenant, dto.companyId, 'companyId');
    }
    const data: Prisma.DealUncheckedUpdateInput = {};
    const activities: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const other: string[] = [];
    if (dto.title !== undefined && dto.title !== existing.title) {
      data.title = dto.title;
      other.push('title');
    }
    if (dto.description !== undefined && dto.description !== existing.description) {
      data.description = dto.description;
      other.push('description');
    }
    const previousValue = decimalToNumber(existing.value);
    if (dto.value !== undefined && dto.value !== previousValue) {
      data.value = dto.value;
      activities.push({ type: 'value_changed', payload: { from: previousValue, to: dto.value } });
    }
    if (dto.currency !== undefined && dto.currency !== existing.currency) {
      data.currency = dto.currency;
      other.push('currency');
    }
    if (dto.ownerId !== undefined && dto.ownerId !== existing.ownerId) {
      data.ownerId = dto.ownerId;
      activities.push({ type: 'owner_changed', payload: { from: existing.ownerId, to: dto.ownerId } });
    }
    if (dto.contactId !== undefined && dto.contactId !== existing.contactId) {
      data.contactId = dto.contactId;
      other.push('contactId');
    }
    if (dto.companyId !== undefined && dto.companyId !== existing.companyId) {
      data.companyId = dto.companyId;
      other.push('companyId');
    }
    if (dto.expectedCloseAt !== undefined) {
      const next = dto.expectedCloseAt ? new Date(dto.expectedCloseAt) : null;
      if ((next?.getTime() ?? null) !== (existing.expectedCloseAt?.getTime() ?? null)) {
        data.expectedCloseAt = next;
        other.push('expectedCloseAt');
      }
    }
    if (dto.lostReason !== undefined && dto.lostReason !== existing.lostReason) {
      data.lostReason = dto.lostReason;
      other.push('lostReason');
    }
    if (dto.tags !== undefined && JSON.stringify(dto.tags) !== JSON.stringify(existing.tags)) {
      data.tags = dto.tags;
      other.push('tags');
    }
    if (Object.keys(data).length === 0) return toDealWithRelations(existing);
    if (other.length > 0) activities.push({ type: 'updated', payload: { fields: other } });

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.deal.update({ where: { id: existing.id }, data, include: DEAL_INCLUDE });
      const base = Date.now();
      await tx.dealActivity.createMany({
        data: activities.map((a, i) => ({
          organizationId: tenant.organizationId,
          dealId: existing.id,
          actorId: tenant.userId,
          type: a.type,
          payload: a.payload as Prisma.InputJsonObject,
          createdAt: new Date(base + i),
        })),
      });
      return row;
    });
    await this.audit.log({
      action: AuditAction.DEAL_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'deal',
      targetId: existing.id,
      metadata: { changes: Object.keys(data) },
      request: meta,
    });
    return toDealWithRelations(updated);
  }

  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const result = await this.prisma.client.deal.deleteMany({
      where: { id, organizationId: tenant.organizationId },
    });
    if (result.count === 0) throw AppException.notFound('Deal');
    await this.audit.log({
      action: AuditAction.DEAL_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'deal',
      targetId: id,
      request: meta,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Stage moves (Kanban)
  // ---------------------------------------------------------------------------------------------

  async move(
    tenant: TenantContext,
    id: string,
    dto: MoveDealRequest,
    meta: RequestMeta,
  ): Promise<DealWithRelations> {
    await this.requireDeal(tenant, id); // 404 for foreign ids before any locking
    let result;
    try {
      result = await this.prisma.client.$transaction(
        (tx) =>
          moveDealRow(
            tx,
            {
              organizationId: tenant.organizationId,
              dealId: id,
              toStageId: dto.stageId,
              position: dto.position ?? null,
              lostReason: dto.lostReason ?? null,
            },
            { actorId: tenant.userId, by: 'human' },
          ),
        { timeout: 15_000 },
      );
    } catch (error) {
      if (error instanceof DomainError) {
        if (error.code === 'not_found') throw AppException.notFound('Deal');
        throw AppException.validation(error.message, [
          { path: 'stageId', message: error.message, code: 'custom' },
        ]);
      }
      throw error;
    }
    const row = await this.requireDeal(tenant, id);
    if (result.stageChanged) {
      await this.audit.log({
        action: AuditAction.DEAL_STAGE_CHANGED,
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        targetType: 'deal',
        targetId: id,
        metadata: { from: result.fromStage.name, to: result.toStage.name, status: row.status },
        request: meta,
      });
      const payload = {
        ...dealEventPayload(row),
        fromStageId: result.fromStage.id,
        fromStage: result.fromStage.name,
        previousStatus: result.previousStatus,
      };
      await this.emit(tenant, meta, 'deal.stage_changed', payload);
      if (row.status !== result.previousStatus && row.status !== 'open') {
        await this.emit(tenant, meta, row.status === 'won' ? 'deal.won' : 'deal.lost', payload);
      }
    }
    return toDealWithRelations(row);
  }

  // ---------------------------------------------------------------------------------------------
  // Board
  // ---------------------------------------------------------------------------------------------

  async board(tenant: TenantContext, query: BoardQuery): Promise<DealBoard> {
    const pipelineRow = query.pipelineId
      ? await this.prisma.client.pipeline.findFirst({
          where: { id: query.pipelineId, organizationId: tenant.organizationId },
          include: { stages: { orderBy: { order: 'asc' } } },
        })
      : await ensureDefaultPipeline(this.prisma.client, tenant.organizationId).then((p) =>
          this.prisma.client.pipeline.findFirst({
            where: { id: p.id, organizationId: tenant.organizationId },
            include: { stages: { orderBy: { order: 'asc' } } },
          }),
        );
    if (!pipelineRow) throw AppException.notFound('Pipeline');
    const dealCount = await this.prisma.client.deal.count({
      where: { organizationId: tenant.organizationId, pipelineId: pipelineRow.id },
    });

    const filter: Prisma.DealWhereInput = {
      organizationId: tenant.organizationId,
      pipelineId: pipelineRow.id,
      ...(query.ownerId ? { ownerId: query.ownerId === 'me' ? tenant.userId : query.ownerId } : {}),
      ...(query.search ? { OR: dealSearchClauses(query.search) } : {}),
    };
    const sums = await this.prisma.client.deal.groupBy({
      by: ['stageId', 'currency'],
      where: filter,
      _count: { _all: true },
      _sum: { value: true },
    });

    const stages = query.includeClosed ? pipelineRow.stages : pipelineRow.stages.filter((s) => s.kind === 'open');
    const columns: BoardColumn[] = [];
    const overall = new Map<string, CurrencyTotal>();
    for (const stage of stages) {
      const probability = effectiveProbability(stage.kind, stage.probability);
      const stageSums = sums.filter((s) => s.stageId === stage.id);
      const totals: CurrencyTotal[] = stageSums.map((s) => {
        const value = round2(Number(s._sum.value ?? 0));
        return {
          currency: s.currency,
          count: s._count._all,
          value,
          weightedValue: stage.kind === 'lost' ? 0 : weightedValue(value, probability),
        };
      });
      const count = totals.reduce((n, t) => n + t.count, 0);
      const rows = await this.prisma.client.deal.findMany({
        where: { ...filter, stageId: stage.id },
        include: DEAL_INCLUDE,
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        take: query.limitPerColumn,
      });
      columns.push({
        stage: {
          id: stage.id,
          pipelineId: stage.pipelineId,
          name: stage.name,
          order: stage.order,
          probability: stage.probability,
          kind: stage.kind,
        },
        deals: rows.map(toDealWithRelations),
        count,
        hasMore: count > rows.length,
        totals: totals.sort((a, b) => a.currency.localeCompare(b.currency)),
      });
      for (const t of totals) {
        const acc = overall.get(t.currency) ?? { currency: t.currency, count: 0, value: 0, weightedValue: 0 };
        acc.count += t.count;
        acc.value = round2(acc.value + t.value);
        acc.weightedValue = round2(acc.weightedValue + t.weightedValue);
        overall.set(t.currency, acc);
      }
    }
    return {
      pipeline: toPipeline(pipelineRow, dealCount),
      columns,
      totals: [...overall.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Notes & activities
  // ---------------------------------------------------------------------------------------------

  async listNotes(
    tenant: TenantContext,
    dealId: string,
    query: PaginationQuery,
  ): Promise<PageResult<DealNoteWithAuthor>> {
    await this.requireDeal(tenant, dealId);
    const where = { organizationId: tenant.organizationId, dealId };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.dealNote.findMany({
        where,
        include: DEAL_NOTE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.dealNote.count({ where }),
    ]);
    return page(rows.map(toDealNote), query, total);
  }

  async addNote(
    tenant: TenantContext,
    dealId: string,
    body: string,
    meta: RequestMeta,
  ): Promise<DealNoteWithAuthor> {
    const deal = await this.requireDeal(tenant, dealId);
    const note = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.dealNote.create({
        data: { organizationId: tenant.organizationId, dealId: deal.id, authorId: tenant.userId, body },
        include: DEAL_NOTE_INCLUDE,
      });
      await tx.dealActivity.create({
        data: {
          organizationId: tenant.organizationId,
          dealId: deal.id,
          actorId: tenant.userId,
          type: 'note_added',
          payload: { noteId: created.id, preview: truncate(body, 120) },
        },
      });
      return created;
    });
    await this.audit.log({
      action: AuditAction.DEAL_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'deal',
      targetId: deal.id,
      metadata: { kind: 'note_added', noteId: note.id },
      request: meta,
    });
    return toDealNote(note);
  }

  async deleteNote(
    tenant: TenantContext,
    dealId: string,
    noteId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const deal = await this.requireDeal(tenant, dealId);
    const note = await this.prisma.client.dealNote.findFirst({
      where: { id: noteId, dealId: deal.id, organizationId: tenant.organizationId },
    });
    if (!note) throw AppException.notFound('Note');
    if (note.authorId !== tenant.userId && !tenant.permissions.includes('deals:delete')) {
      throw AppException.forbidden('Only the author (or a member with deals:delete) can delete this note');
    }
    await this.prisma.client.dealNote.delete({ where: { id: note.id } });
    await this.audit.log({
      action: AuditAction.DEAL_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'deal',
      targetId: deal.id,
      metadata: { kind: 'note_deleted', noteId: note.id, authorId: note.authorId },
      request: meta,
    });
  }

  async listActivities(
    tenant: TenantContext,
    dealId: string,
    query: PaginationQuery,
  ): Promise<PageResult<DealActivityWithActor>> {
    await this.requireDeal(tenant, dealId);
    const where = { organizationId: tenant.organizationId, dealId };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.dealActivity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.dealActivity.count({ where }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => !!v))];
    const actors = actorIds.length
      ? await this.prisma.client.user.findMany({ where: { id: { in: actorIds } }, select: USER_SUMMARY_SELECT })
      : [];
    const byId = new Map<string, UserSummaryRow>(actors.map((a) => [a.id, a]));
    return page(
      rows.map((r) => toDealActivity(r, r.actorId ? byId.get(r.actorId) : null)),
      query,
      total,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Conversion report
  // ---------------------------------------------------------------------------------------------

  async conversion(tenant: TenantContext, query: DealConversionQuery): Promise<DealConversionReport> {
    const org = tenant.organizationId;
    const db = this.prisma.client;
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 86_400_000);
    if (from.getTime() >= to.getTime()) {
      throw AppException.validation('from must be before to', [
        { path: 'from', message: 'from must be before to', code: 'custom' },
      ]);
    }
    const pipeline = query.pipelineId
      ? await db.pipeline.findFirst({
          where: { id: query.pipelineId, organizationId: org },
          include: { stages: { orderBy: { order: 'asc' } } },
        })
      : await ensureDefaultPipeline(db, org).then((p) =>
          db.pipeline.findFirst({
            where: { id: p.id, organizationId: org },
            include: { stages: { orderBy: { order: 'asc' } } },
          }),
        );
    if (!pipeline) throw AppException.notFound('Pipeline');

    const [reach, valueRows, wonRows, cycle, lostReasons] = await Promise.all([
      db.$queryRaw<Array<{ maxOrder: number; status: 'open' | 'won' | 'lost'; n: number }>>`
        SELECT x.max_order AS "maxOrder", x.status::text AS status, COUNT(*)::int AS n
        FROM (
          SELECT d."id", d."status", COALESCE(MAX(s."order") FILTER (WHERE s."kind" = 'open'), -1) AS max_order
          FROM "Deal" d
          LEFT JOIN "DealStageChange" c ON c."dealId" = d."id" AND c."organizationId" = d."organizationId"
          LEFT JOIN "PipelineStage" s ON s."id" = c."toStageId"
          WHERE d."organizationId" = ${org}::uuid AND d."pipelineId" = ${pipeline.id}::uuid
            AND d."createdAt" >= ${from} AND d."createdAt" < ${to}
          GROUP BY d."id", d."status"
        ) x
        GROUP BY 1, 2`,
      db.deal.groupBy({
        by: ['stageId', 'currency'],
        where: { organizationId: org, pipelineId: pipeline.id },
        _count: { _all: true },
        _sum: { value: true },
      }),
      db.deal.groupBy({
        by: ['currency'],
        where: { organizationId: org, pipelineId: pipeline.id, status: 'won', closedAt: { gte: from, lt: to } },
        _count: { _all: true },
        _sum: { value: true },
      }),
      db.$queryRaw<Array<{ days: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 86400)::float8 AS days
        FROM "Deal"
        WHERE "organizationId" = ${org}::uuid AND "pipelineId" = ${pipeline.id}::uuid AND "status" = 'won'
          AND "closedAt" >= ${from} AND "closedAt" < ${to}`,
      db.$queryRaw<Array<{ reason: string; n: number }>>`
        SELECT COALESCE(NULLIF(btrim("lostReason"), ''), '(no reason)') AS reason, COUNT(*)::int AS n
        FROM "Deal"
        WHERE "organizationId" = ${org}::uuid AND "pipelineId" = ${pipeline.id}::uuid AND "status" = 'lost'
          AND "closedAt" >= ${from} AND "closedAt" < ${to}
        GROUP BY 1 ORDER BY n DESC, reason ASC LIMIT 10`,
    ]);

    const counts = { created: 0, open: 0, won: 0, lost: 0 };
    for (const r of reach) {
      counts.created += r.n;
      counts[r.status] += r.n;
    }
    const stageMeta = new Map(pipeline.stages.map((s) => [s.id, s]));
    const days = cycle[0]?.days;
    return {
      generatedAt: new Date().toISOString(),
      pipeline: { id: pipeline.id, name: pipeline.name },
      range: { from: from.toISOString(), to: to.toISOString() },
      deals: counts,
      winRate: winRate(counts.won, counts.lost),
      avgCycleDays: days === null || days === undefined ? null : Math.round(days * 10) / 10,
      stages: stageConversion(
        pipeline.stages.map((s) => ({ id: s.id, name: s.name, order: s.order, kind: s.kind })),
        reach,
      ),
      valueByStage: valueRows
        .map((r) => {
          const stage = stageMeta.get(r.stageId);
          if (!stage) return null;
          const value = round2(Number(r._sum.value ?? 0));
          const probability = effectiveProbability(stage.kind, stage.probability);
          return {
            stageId: stage.id,
            name: stage.name,
            kind: stage.kind,
            order: stage.order,
            currency: r.currency,
            count: r._count._all,
            value,
            weightedValue: stage.kind === 'lost' ? 0 : weightedValue(value, probability),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => a.order - b.order || a.currency.localeCompare(b.currency))
        .map(({ order: _order, ...rest }) => rest),
      wonValue: wonRows
        .map((r) => ({ currency: r.currency, count: r._count._all, value: round2(Number(r._sum.value ?? 0)) }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      lostReasons: lostReasons.map((r) => ({ reason: r.reason, count: r.n })),
    };
  }

  // ---------------------------------------------------------------------------------------------

  async requireDeal(tenant: TenantContext, id: string): Promise<DealRow> {
    const deal = await this.prisma.client.deal.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: DEAL_INCLUDE,
    });
    if (!deal) throw AppException.notFound('Deal');
    return deal;
  }

  /** `stageId` decides the pipeline when given; otherwise the pipeline (default when omitted) and its first open stage. */
  private async resolvePipelineAndStage(
    tenant: TenantContext,
    pipelineId?: string,
    stageId?: string,
  ): Promise<{ pipelineId: string; stageId: string }> {
    const db = this.prisma.client;
    if (stageId) {
      const stage = await db.pipelineStage.findFirst({
        where: { id: stageId, organizationId: tenant.organizationId },
      });
      if (!stage || (pipelineId && stage.pipelineId !== pipelineId)) {
        throw AppException.validation('Stage not found in this pipeline', [
          { path: 'stageId', message: 'Stage not found in this pipeline', code: 'custom' },
        ]);
      }
      return { pipelineId: stage.pipelineId, stageId: stage.id };
    }
    let resolvedPipelineId = pipelineId;
    if (resolvedPipelineId) {
      const exists = await db.pipeline.findFirst({
        where: { id: resolvedPipelineId, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!exists) {
        throw AppException.validation('Pipeline not found in this organization', [
          { path: 'pipelineId', message: 'Pipeline not found in this organization', code: 'custom' },
        ]);
      }
    } else {
      resolvedPipelineId = (await ensureDefaultPipeline(db, tenant.organizationId)).id;
    }
    const first = await db.pipelineStage.findFirst({
      where: { pipelineId: resolvedPipelineId, organizationId: tenant.organizationId, kind: 'open' },
      orderBy: { order: 'asc' },
    });
    if (!first) throw AppException.conflict('The pipeline has no open stage');
    return { pipelineId: resolvedPipelineId, stageId: first.id };
  }

  private async emit(
    tenant: TenantContext,
    meta: RequestMeta,
    event: DealEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events?.emit(tenant.organizationId, event, payload, {
      actorUserId: tenant.userId,
      requestId: meta.requestId,
    });
  }
}

/** Domain-event payload. `assigneeId` mirrors the owner so the `assignee` notification target works for deals. */
export function dealEventPayload(
  deal: Pick<Deal, 'id' | 'title' | 'status' | 'currency' | 'pipelineId' | 'stageId' | 'ownerId' | 'contactId' | 'companyId'> & {
    value: unknown;
    stage?: { name: string };
  },
): Record<string, unknown> {
  return {
    dealId: deal.id,
    title: deal.title,
    status: deal.status,
    value: decimalToNumber(deal.value as never),
    currency: deal.currency,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    ...(deal.stage ? { stage: deal.stage.name } : {}),
    ownerId: deal.ownerId,
    assigneeId: deal.ownerId,
    contactId: deal.contactId,
    companyId: deal.companyId,
  };
}

export function dealSearchClauses(search: string): Prisma.DealWhereInput[] {
  const contains = { contains: search, mode: 'insensitive' as const };
  return [
    { title: contains },
    { description: contains },
    { contact: { firstName: contains } },
    { contact: { lastName: contains } },
    { company: { name: contains } },
  ];
}

export function buildDealWhere(
  tenant: Pick<TenantContext, 'organizationId' | 'userId'>,
  query: Partial<ListDealsQuery>,
): Prisma.DealWhereInput {
  const value: Prisma.DecimalNullableFilter = {};
  if (query.minValue !== undefined) value.gte = query.minValue;
  if (query.maxValue !== undefined) value.lte = query.maxValue;
  const close: Prisma.DateTimeNullableFilter = {};
  if (query.expectedCloseFrom) close.gte = new Date(query.expectedCloseFrom);
  if (query.expectedCloseTo) close.lt = new Date(query.expectedCloseTo);
  return {
    organizationId: tenant.organizationId,
    ...(query.pipelineId ? { pipelineId: query.pipelineId } : {}),
    ...(query.stageId ? { stageId: query.stageId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.ownerId ? { ownerId: query.ownerId === 'me' ? tenant.userId : query.ownerId } : {}),
    ...(query.contactId ? { contactId: query.contactId } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    ...(Object.keys(value).length > 0 ? { value } : {}),
    ...(Object.keys(close).length > 0 ? { expectedCloseAt: close } : {}),
    ...(query.search ? { OR: dealSearchClauses(query.search) } : {}),
  };
}

export function dealOrderBy(query: Pick<ListDealsQuery, 'sortBy' | 'sortOrder'>): Prisma.DealOrderByWithRelationInput[] {
  if (query.sortBy === 'value' || query.sortBy === 'expectedCloseAt') {
    return [{ [query.sortBy]: { sort: query.sortOrder, nulls: 'last' } }, { id: 'asc' }];
  }
  return [{ [query.sortBy]: query.sortOrder }, { id: 'asc' }];
}
