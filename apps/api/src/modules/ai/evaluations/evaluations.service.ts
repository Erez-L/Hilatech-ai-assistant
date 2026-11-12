import {
  AuditAction,
  type CreateEvaluationCaseRequest,
  type CreateEvaluationDatasetRequest,
  EVALUATION_LIMITS,
  type EvaluationCase,
  type EvaluationCheck,
  type EvaluationCheckResult,
  type EvaluationDataset,
  type EvaluationDatasetDetail,
  type EvaluationRun,
  type EvaluationRunDetail,
  type ListEvaluationRunsQuery,
  QueueName,
  type StartEvaluationRunRequest,
  type UpdateEvaluationCaseRequest,
  type UpdateEvaluationDatasetRequest,
} from '@hilatech/contracts';
import { type Prisma } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { type RequestMeta } from '../../../common/request';
import { type PageResult, page, skipTake } from '../../../common/utils/pagination';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../../infrastructure/queue/queue.service';
import { AuditService } from '../../audit/audit.service';
import { EntitlementsService } from '../../billing/entitlements.service';
import { AgentRules } from '../agents/agent.rules';
import { AgentsService } from '../agents/agents.service';

const RUN_INCLUDE = {
  dataset: { select: { name: true } },
  agent: { select: { name: true } },
} satisfies Prisma.EvaluationRunInclude;
type RunRow = Prisma.EvaluationRunGetPayload<{ include: typeof RUN_INCLUDE }>;

const DATASET_INCLUDE = {
  _count: { select: { cases: true } },
  runs: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.EvaluationDatasetInclude;
type DatasetRow = Prisma.EvaluationDatasetGetPayload<{ include: typeof DATASET_INCLUDE }>;

type CaseRow = Prisma.EvaluationCaseGetPayload<object>;

export const evaluationRunJobId = (runId: string): string => `evaluation-run-${runId}`;

function toCase(row: CaseRow): EvaluationCase {
  return {
    id: row.id,
    datasetId: row.datasetId,
    name: row.name,
    input: row.input,
    checks: (row.checks ?? []) as unknown as EvaluationCheck[],
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDataset(row: DatasetRow): EvaluationDataset {
  const last = row.runs[0];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    caseCount: row._count.cases,
    lastRun: last
      ? {
          id: last.id,
          status: last.status,
          passed: last.passed,
          total: last.totalCases,
          finishedAt: last.finishedAt ? last.finishedAt.toISOString() : null,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEvaluationRun(row: RunRow): EvaluationRun {
  const done = row.status === 'completed' && row.totalCases > 0;
  return {
    id: row.id,
    datasetId: row.datasetId,
    datasetName: row.dataset.name,
    agentId: row.agentId,
    agentName: row.agent.name,
    status: row.status,
    totalCases: row.totalCases,
    passed: row.passed,
    failed: row.failed,
    errored: row.errored,
    passRate: done ? Math.round((row.passed / row.totalCases) * 1000) / 10 : null,
    error: row.error,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Evaluation datasets (cases with deterministic checks) and runs. A run is executed by the workers
 * (`ai-tasks`, kind `evaluation_run`): one agent execution per case, scored against the case's checks.
 */
@Injectable()
export class EvaluationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agents: AgentsService,
    private readonly entitlements: EntitlementsService,
    private readonly queue: QueueService,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Datasets
  // -------------------------------------------------------------------------------------------

  async listDatasets(tenant: TenantContext): Promise<EvaluationDataset[]> {
    const rows = await this.prisma.client.evaluationDataset.findMany({
      where: { organizationId: tenant.organizationId },
      include: DATASET_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toDataset);
  }

  async getDataset(tenant: TenantContext, id: string): Promise<EvaluationDatasetDetail> {
    const row = await this.prisma.client.evaluationDataset.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: {
        ...DATASET_INCLUDE,
        cases: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!row) throw AppException.notFound('Evaluation dataset');
    return { ...toDataset(row), cases: row.cases.map(toCase) };
  }

  async createDataset(
    tenant: TenantContext,
    dto: CreateEvaluationDatasetRequest,
    meta: RequestMeta,
  ): Promise<EvaluationDataset> {
    const row = await this.prisma.client.evaluationDataset.create({
      data: {
        organizationId: tenant.organizationId,
        name: dto.name,
        description: dto.description ?? null,
        createdById: tenant.userId,
      },
      include: DATASET_INCLUDE,
    });
    await this.audit.log({
      action: AuditAction.EVALUATION_DATASET_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'evaluation_dataset',
      targetId: row.id,
      metadata: { name: row.name },
      request: meta,
    });
    return toDataset(row);
  }

  async updateDataset(
    tenant: TenantContext,
    id: string,
    dto: UpdateEvaluationDatasetRequest,
  ): Promise<EvaluationDataset> {
    await this.requireDataset(tenant, id);
    const row = await this.prisma.client.evaluationDataset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
      include: DATASET_INCLUDE,
    });
    return toDataset(row);
  }

  async deleteDataset(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const dataset = await this.requireDataset(tenant, id);
    await this.prisma.client.evaluationDataset.delete({ where: { id } });
    await this.audit.log({
      action: AuditAction.EVALUATION_DATASET_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'evaluation_dataset',
      targetId: id,
      metadata: { name: dataset.name },
      request: meta,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Cases
  // -------------------------------------------------------------------------------------------

  async addCase(
    tenant: TenantContext,
    datasetId: string,
    dto: CreateEvaluationCaseRequest,
  ): Promise<EvaluationCase> {
    await this.requireDataset(tenant, datasetId);
    const existing = await this.prisma.client.evaluationCase.aggregate({
      where: { datasetId, organizationId: tenant.organizationId },
      _count: { _all: true },
      _max: { position: true },
    });
    if (existing._count._all >= EVALUATION_LIMITS.maxCasesPerDataset) {
      throw AppException.conflict(
        `A dataset can hold at most ${EVALUATION_LIMITS.maxCasesPerDataset} cases`,
      );
    }
    const row = await this.prisma.client.evaluationCase.create({
      data: {
        organizationId: tenant.organizationId,
        datasetId,
        name: dto.name,
        input: dto.input,
        checks: dto.checks as unknown as Prisma.InputJsonValue,
        position: (existing._max.position ?? -1) + 1,
      },
    });
    return toCase(row);
  }

  async updateCase(
    tenant: TenantContext,
    datasetId: string,
    caseId: string,
    dto: UpdateEvaluationCaseRequest,
  ): Promise<EvaluationCase> {
    await this.requireCase(tenant, datasetId, caseId);
    const row = await this.prisma.client.evaluationCase.update({
      where: { id: caseId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.input !== undefined ? { input: dto.input } : {}),
        ...(dto.checks !== undefined
          ? { checks: dto.checks as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return toCase(row);
  }

  async deleteCase(tenant: TenantContext, datasetId: string, caseId: string): Promise<void> {
    await this.requireCase(tenant, datasetId, caseId);
    await this.prisma.client.evaluationCase.delete({ where: { id: caseId } });
  }

  // -------------------------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------------------------

  async startRun(
    tenant: TenantContext,
    datasetId: string,
    dto: StartEvaluationRunRequest,
    meta: RequestMeta,
  ): Promise<EvaluationRun> {
    await this.entitlements.assertWithinLimit(tenant, 'ai_tokens');
    await this.requireDataset(tenant, datasetId);
    const agent = await this.agents.requireAgent(tenant, dto.agentId);
    AgentRules.assertExecutable(agent);
    const totalCases = await this.prisma.client.evaluationCase.count({
      where: { datasetId, organizationId: tenant.organizationId },
    });
    if (totalCases === 0) throw AppException.conflict('Add at least one case before running');
    const active = await this.prisma.client.evaluationRun.count({
      where: {
        organizationId: tenant.organizationId,
        datasetId,
        agentId: agent.id,
        status: { in: ['queued', 'running'] },
      },
    });
    if (active > 0) {
      throw AppException.conflict('A run of this dataset with this agent is already in progress');
    }

    const run = await this.prisma.client.evaluationRun.create({
      data: {
        organizationId: tenant.organizationId,
        datasetId,
        agentId: agent.id,
        totalCases,
        triggeredByUserId: tenant.userId,
      },
      include: RUN_INCLUDE,
    });
    await this.queue.enqueue(QueueName.AI_TASKS, {
      organizationId: tenant.organizationId,
      kind: 'evaluation_run',
      targetId: run.id,
      requestedByUserId: tenant.userId,
      idempotencyKey: evaluationRunJobId(run.id),
      requestId: meta.requestId ?? undefined,
      enqueuedAt: new Date().toISOString(),
    });
    await this.audit.log({
      action: AuditAction.EVALUATION_RUN_STARTED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'evaluation_run',
      targetId: run.id,
      metadata: { datasetId, agentId: agent.id, totalCases },
      request: meta,
    });
    return toEvaluationRun(run);
  }

  async listRuns(
    tenant: TenantContext,
    query: ListEvaluationRunsQuery,
  ): Promise<PageResult<EvaluationRun>> {
    const where: Prisma.EvaluationRunWhereInput = {
      organizationId: tenant.organizationId,
      ...(query.datasetId ? { datasetId: query.datasetId } : {}),
      ...(query.agentId ? { agentId: query.agentId } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.evaluationRun.findMany({
        where,
        include: RUN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.evaluationRun.count({ where }),
    ]);
    return page(rows.map(toEvaluationRun), query, total);
  }

  async getRun(tenant: TenantContext, id: string): Promise<EvaluationRunDetail> {
    const row = await this.prisma.client.evaluationRun.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: { ...RUN_INCLUDE, results: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw AppException.notFound('Evaluation run');
    return {
      ...toEvaluationRun(row),
      results: row.results.map((r) => ({
        id: r.id,
        caseId: r.caseId,
        caseName: r.caseName,
        input: r.input,
        status: r.status,
        output: r.output,
        error: r.error,
        checks: (r.checks ?? []) as unknown as EvaluationCheckResult[],
        executionId: r.executionId,
        durationMs: r.durationMs,
      })),
    };
  }

  /** queued → cancelled immediately; running → the worker stops before the next case. */
  async cancelRun(tenant: TenantContext, id: string): Promise<EvaluationRun> {
    const updated = await this.prisma.client.evaluationRun.updateMany({
      where: { id, organizationId: tenant.organizationId, status: { in: ['queued', 'running'] } },
      data: { status: 'cancelled', finishedAt: new Date() },
    });
    const row = await this.prisma.client.evaluationRun.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: RUN_INCLUDE,
    });
    if (!row) throw AppException.notFound('Evaluation run');
    if (updated.count === 0) throw AppException.conflict('The run has already finished');
    return toEvaluationRun(row);
  }

  private async requireDataset(tenant: TenantContext, id: string) {
    const row = await this.prisma.client.evaluationDataset.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!row) throw AppException.notFound('Evaluation dataset');
    return row;
  }

  private async requireCase(tenant: TenantContext, datasetId: string, caseId: string) {
    const row = await this.prisma.client.evaluationCase.findFirst({
      where: { id: caseId, datasetId, organizationId: tenant.organizationId },
    });
    if (!row) throw AppException.notFound('Evaluation case');
    return row;
  }
}
