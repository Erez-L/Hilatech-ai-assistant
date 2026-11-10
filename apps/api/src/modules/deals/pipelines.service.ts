import {
  AuditAction,
  type CreatePipelineRequest,
  type CreateStageRequest,
  DEFAULT_STAGES,
  type DeleteStageQuery,
  type Pipeline as PipelineDto,
  type PipelineStage as PipelineStageDto,
  type ReorderStagesRequest,
  type UpdatePipelineRequest,
  type UpdateStageRequest,
  effectiveProbability,
  stageOrderAfterInsert,
  stageOrders,
  statusForKind,
  validateStageReorder,
  validateStageSet,
} from '@hilatech/contracts';
import { Prisma, ensureDefaultPipeline } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toPipeline, toStage } from './deals.mappers';

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** All pipelines with stages and deal counts (creates the default pipeline when the organization has none). */
  async list(tenant: TenantContext): Promise<PipelineDto[]> {
    await ensureDefaultPipeline(this.prisma.client, tenant.organizationId);
    const rows = await this.prisma.client.pipeline.findMany({
      where: { organizationId: tenant.organizationId },
      include: { stages: { orderBy: { order: 'asc' } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    const counts = await this.prisma.client.deal.groupBy({
      by: ['pipelineId'],
      where: { organizationId: tenant.organizationId },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.pipelineId, c._count._all]));
    return rows.map((r) => toPipeline(r, byId.get(r.id) ?? 0));
  }

  async get(tenant: TenantContext, id: string): Promise<PipelineDto> {
    const row = await this.requirePipeline(tenant, id);
    const dealCount = await this.prisma.client.deal.count({
      where: { organizationId: tenant.organizationId, pipelineId: id },
    });
    return toPipeline(row, dealCount);
  }

  async create(
    tenant: TenantContext,
    dto: CreatePipelineRequest,
    meta: RequestMeta,
  ): Promise<PipelineDto> {
    const stages = dto.stages ?? DEFAULT_STAGES.map((s) => ({ ...s }));
    const problem = validateStageSet(stages);
    if (problem) throw AppException.validation(problem, [{ path: 'stages', message: problem, code: 'custom' }]);
    if (new Set(stages.map((s) => s.name.toLowerCase())).size !== stages.length) {
      throw AppException.validation('Stage names must be unique', [
        { path: 'stages', message: 'Stage names must be unique', code: 'custom' },
      ]);
    }
    try {
      const created = await this.prisma.client.$transaction(async (tx) => {
        const hasAny = await tx.pipeline.count({ where: { organizationId: tenant.organizationId } });
        const makeDefault = dto.isDefault || hasAny === 0;
        if (makeDefault) {
          await tx.pipeline.updateMany({
            where: { organizationId: tenant.organizationId, isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.pipeline.create({
          data: {
            organizationId: tenant.organizationId,
            name: dto.name,
            isDefault: makeDefault,
            stages: {
              create: stages.map((s, order) => ({
                organizationId: tenant.organizationId,
                name: s.name,
                order,
                probability: effectiveProbability(s.kind, s.probability),
                kind: s.kind,
              })),
            },
          },
          include: { stages: { orderBy: { order: 'asc' } } },
        });
      });
      await this.audit.log({
        action: AuditAction.PIPELINE_CREATED,
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        targetType: 'pipeline',
        targetId: created.id,
        metadata: { name: created.name, stages: created.stages.length },
        request: meta,
      });
      return toPipeline(created, 0);
    } catch (error) {
      if (isUnique(error)) throw AppException.conflict('A pipeline with this name already exists');
      throw error;
    }
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdatePipelineRequest,
    meta: RequestMeta,
  ): Promise<PipelineDto> {
    await this.requirePipeline(tenant, id);
    try {
      await this.prisma.client.$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.pipeline.updateMany({
            where: { organizationId: tenant.organizationId, isDefault: true, id: { not: id } },
            data: { isDefault: false },
          });
        }
        await tx.pipeline.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.isDefault ? { isDefault: true } : {}),
          },
        });
      });
    } catch (error) {
      if (isUnique(error)) throw AppException.conflict('A pipeline with this name already exists');
      throw error;
    }
    await this.audit.log({
      action: AuditAction.PIPELINE_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'pipeline',
      targetId: id,
      metadata: { changes: Object.keys(dto) },
      request: meta,
    });
    return this.get(tenant, id);
  }

  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const pipeline = await this.requirePipeline(tenant, id);
    if (pipeline.isDefault) throw AppException.conflict('The default pipeline cannot be deleted');
    const deals = await this.prisma.client.deal.count({
      where: { organizationId: tenant.organizationId, pipelineId: id },
    });
    if (deals > 0) {
      throw AppException.conflict('The pipeline still has deals; move or delete them first', { deals });
    }
    await this.prisma.client.pipeline.deleteMany({
      where: { id, organizationId: tenant.organizationId },
    });
    await this.audit.log({
      action: AuditAction.PIPELINE_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'pipeline',
      targetId: id,
      metadata: { name: pipeline.name },
      request: meta,
    });
  }

  // ----- stages ------------------------------------------------------------------------------

  async createStage(
    tenant: TenantContext,
    pipelineId: string,
    dto: CreateStageRequest,
    meta: RequestMeta,
  ): Promise<PipelineDto> {
    const pipeline = await this.requirePipeline(tenant, pipelineId);
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.pipelineStage.create({
          data: {
            organizationId: tenant.organizationId,
            pipelineId,
            name: dto.name,
            order: pipeline.stages.length,
            probability: effectiveProbability(dto.kind, dto.probability),
            kind: dto.kind,
          },
        });
        const ordered = stageOrderAfterInsert(pipeline.stages, created.id, dto.kind, dto.order);
        await this.applyStageOrder(tx, tenant.organizationId, ordered);
      });
    } catch (error) {
      if (isUnique(error)) throw AppException.conflict('A stage with this name already exists in the pipeline');
      throw error;
    }
    await this.auditPipeline(tenant, pipelineId, meta, { kind: 'stage_created', name: dto.name });
    return this.get(tenant, pipelineId);
  }

  async updateStage(
    tenant: TenantContext,
    pipelineId: string,
    stageId: string,
    dto: UpdateStageRequest,
    meta: RequestMeta,
  ): Promise<PipelineDto> {
    const pipeline = await this.requirePipeline(tenant, pipelineId);
    const stage = pipeline.stages.find((s) => s.id === stageId);
    if (!stage) throw AppException.notFound('Stage');
    const nextKind = dto.kind ?? stage.kind;
    const problem = validateStageSet(
      pipeline.stages.map((s) => ({ kind: s.id === stageId ? nextKind : s.kind })),
    );
    if (problem) throw AppException.conflict(problem);
    try {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.pipelineStage.update({
          where: { id: stageId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            kind: nextKind,
            probability: effectiveProbability(nextKind, dto.probability ?? stage.probability),
          },
        });
        if (nextKind !== stage.kind) {
          // Deals follow the kind of their stage.
          const now = new Date();
          await tx.deal.updateMany({
            where: { organizationId: tenant.organizationId, stageId },
            data: {
              status: statusForKind(nextKind),
              ...(nextKind === 'open' ? { closedAt: null, lostReason: null } : {}),
            },
          });
          if (nextKind !== 'open') {
            await tx.deal.updateMany({
              where: { organizationId: tenant.organizationId, stageId, closedAt: null },
              data: { closedAt: now },
            });
          }
          if (nextKind !== 'lost') {
            await tx.deal.updateMany({
              where: { organizationId: tenant.organizationId, stageId },
              data: { lostReason: null },
            });
          }
        }
      });
    } catch (error) {
      if (isUnique(error)) throw AppException.conflict('A stage with this name already exists in the pipeline');
      throw error;
    }
    await this.auditPipeline(tenant, pipelineId, meta, { kind: 'stage_updated', stageId, changes: Object.keys(dto) });
    return this.get(tenant, pipelineId);
  }

  async deleteStage(
    tenant: TenantContext,
    pipelineId: string,
    stageId: string,
    query: DeleteStageQuery,
    meta: RequestMeta,
  ): Promise<PipelineDto> {
    const pipeline = await this.requirePipeline(tenant, pipelineId);
    const stage = pipeline.stages.find((s) => s.id === stageId);
    if (!stage) throw AppException.notFound('Stage');
    const remaining = pipeline.stages.filter((s) => s.id !== stageId);
    const problem = validateStageSet(remaining);
    if (problem) throw AppException.conflict(problem);

    const dealCount = await this.prisma.client.deal.count({
      where: { organizationId: tenant.organizationId, stageId },
    });
    let target: (typeof remaining)[number] | undefined;
    if (dealCount > 0) {
      target = remaining.find((s) => s.id === query.moveDealsToStageId);
      if (!target) {
        throw AppException.conflict(
          'The stage still has deals; pass moveDealsToStageId (a stage of the same pipeline)',
          { deals: dealCount },
        );
      }
    }
    await this.prisma.client.$transaction(async (tx) => {
      if (target && dealCount > 0) {
        const now = new Date();
        const deals = await tx.deal.findMany({
          where: { organizationId: tenant.organizationId, stageId },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: { id: true },
        });
        const base = await tx.deal.count({
          where: { organizationId: tenant.organizationId, stageId: target.id },
        });
        for (const [i, d] of deals.entries()) {
          await tx.deal.update({
            where: { id: d.id },
            data: {
              stageId: target.id,
              position: base + i,
              stageEnteredAt: now,
              status: statusForKind(target.kind),
              closedAt: target.kind === 'open' ? null : now,
              ...(target.kind !== 'lost' ? { lostReason: null } : {}),
            },
          });
        }
        await tx.dealStageChange.createMany({
          data: deals.map((d) => ({
            organizationId: tenant.organizationId,
            dealId: d.id,
            pipelineId,
            fromStageId: stageId,
            toStageId: (target as { id: string }).id,
            actorId: tenant.userId,
          })),
        });
      }
      await tx.pipelineStage.deleteMany({ where: { id: stageId, organizationId: tenant.organizationId } });
      await this.applyStageOrder(tx, tenant.organizationId, remaining.map((s) => s.id));
    });
    await this.auditPipeline(tenant, pipelineId, meta, {
      kind: 'stage_deleted',
      stageId,
      movedDeals: dealCount,
      movedTo: target?.id ?? null,
    });
    return this.get(tenant, pipelineId);
  }

  async reorderStages(
    tenant: TenantContext,
    pipelineId: string,
    dto: ReorderStagesRequest,
    meta: RequestMeta,
  ): Promise<PipelineDto> {
    const pipeline = await this.requirePipeline(tenant, pipelineId);
    const problem = validateStageReorder(
      pipeline.stages.map((s) => s.id),
      dto.stageIds,
    );
    if (problem) throw AppException.validation(problem, [{ path: 'stageIds', message: problem, code: 'custom' }]);
    await this.prisma.client.$transaction((tx) =>
      this.applyStageOrder(tx, tenant.organizationId, dto.stageIds),
    );
    await this.auditPipeline(tenant, pipelineId, meta, { kind: 'stages_reordered' });
    return this.get(tenant, pipelineId);
  }

  // ----- internals ---------------------------------------------------------------------------

  async requirePipeline(tenant: TenantContext, id: string) {
    const row = await this.prisma.client.pipeline.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    if (!row) throw AppException.notFound('Pipeline');
    return row;
  }

  stageDto(row: Parameters<typeof toStage>[0]): PipelineStageDto {
    return toStage(row);
  }

  private async applyStageOrder(
    tx: Prisma.TransactionClient,
    organizationId: string,
    orderedIds: readonly string[],
  ): Promise<void> {
    for (const { id, position } of stageOrders(orderedIds)) {
      await tx.pipelineStage.updateMany({ where: { id, organizationId }, data: { order: position } });
    }
  }

  private auditPipeline(
    tenant: TenantContext,
    pipelineId: string,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.log({
      action: AuditAction.PIPELINE_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'pipeline',
      targetId: pipelineId,
      metadata,
      request: meta,
    });
  }
}
