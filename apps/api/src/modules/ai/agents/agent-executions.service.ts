import { ProviderResolver } from '@hilatech/ai-engine';
import {
  AGENT_HARD_LIMITS,
  type AgentExecution as AgentExecutionDto,
  type AgentExecutionDetail,
  AuditAction,
  type ExecuteAgentRequest,
  type ListAgentExecutionsQuery,
  QueueName,
} from '@hilatech/contracts';
import { type Prisma } from '@hilatech/database';
import { type TenantContext } from '@hilatech/types';
import { Injectable, Optional } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AppException } from '../../../common/errors/app.exception';
import { type RequestMeta } from '../../../common/request';
import { type PageResult, page, skipTake } from '../../../common/utils/pagination';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../../infrastructure/queue/queue.service';
import { AuditService } from '../../audit/audit.service';
import { EntitlementsService } from '../../billing/entitlements.service';
import { DomainEventsService } from '../../events/domain-events.service';
import { withEngineErrors } from '../core/ai-errors';
import { AiRunnersService } from '../core/ai-runners.service';
import { CancellationService } from '../core/cancellation.service';
import { AgentRules } from './agent.rules';
import {
  EXECUTION_INCLUDE,
  type ExecutionRow,
  toAgentDefinition,
  toAgentExecution,
  toAgentExecutionDetail,
} from './agents.mappers';
import { AgentsService } from './agents.service';

export const executionJobId = (executionId: string): string => `agent-exec-${executionId}`;

export type ExecuteOutcome =
  | { mode: 'async'; execution: AgentExecutionDto }
  | { mode: 'sync'; execution: AgentExecutionDetail };

@Injectable()
export class AgentExecutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agents: AgentsService,
    private readonly entitlements: EntitlementsService,
    private readonly queue: QueueService,
    private readonly runners: AiRunnersService,
    private readonly cancellation: CancellationService,
    private readonly resolver: ProviderResolver,
    private readonly logger: Logger,
    @Optional() private readonly events?: DomainEventsService,
  ) {}

  /**
   * Creates the `AgentExecution` row (queued, root = itself) and either enqueues it on `ai-tasks`
   * (`async`, 202) or runs it inline with the sync caps (`sync`, 200).
   */
  async execute(
    tenant: TenantContext,
    agentId: string,
    dto: ExecuteAgentRequest,
    meta: RequestMeta,
  ): Promise<ExecuteOutcome> {
    await this.entitlements.assertWithinLimit(tenant, 'ai_tokens');
    const agent = await this.agents.requireAgent(tenant, agentId);
    AgentRules.assertExecutable(agent);
    const definition = toAgentDefinition(agent);
    // 409 AI_NOT_CONFIGURED up-front: never create or enqueue an execution that cannot run.
    await withEngineErrors(() => this.resolver.forAgent(definition));

    const execution = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.agentExecution.create({
        data: {
          organizationId: tenant.organizationId,
          agentId: agent.id,
          trigger: 'manual',
          status: 'queued',
          input: dto.input as Prisma.InputJsonValue,
          triggeredByUserId: tenant.userId,
          depth: 0,
        },
      });
      return tx.agentExecution.update({
        where: { id: created.id },
        data: { rootExecutionId: created.id },
        include: EXECUTION_INCLUDE,
      });
    });

    await this.audit.log({
      action: AuditAction.AGENT_EXECUTED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'agent',
      targetId: agent.id,
      metadata: { executionId: execution.id, mode: dto.mode, trigger: 'manual' },
      request: meta,
    });

    if (dto.mode === 'sync') {
      await this.runners.agents.run({
        executionId: execution.id,
        agent: definition,
        input: dto.input,
        userId: tenant.userId,
        userPermissions: tenant.permissions,
        trigger: 'manual',
        depth: 0,
        rootExecutionId: execution.id,
        ancestry: [],
        caps: {
          maxSteps: AGENT_HARD_LIMITS.syncModeMaxSteps,
          maxDurationMs: AGENT_HARD_LIMITS.syncModeMaxDurationMs,
        },
        organizationName: await this.organizationName(tenant.organizationId),
      });
      await this.cancellation.clear(execution.id);
      const detail = await this.detail(tenant, execution.id);
      await this.events?.emit(
        tenant.organizationId,
        detail.status === 'succeeded' ? 'agent.execution_completed' : 'agent.execution_failed',
        {
          executionId: detail.id,
          agentId: agent.id,
          status: detail.status,
          trigger: 'manual',
          error: detail.error ?? null,
        },
        { actorUserId: tenant.userId, requestId: meta.requestId },
      );
      return { mode: 'sync', execution: detail };
    }

    await this.queue.enqueue(QueueName.AI_TASKS, {
      organizationId: tenant.organizationId,
      kind: 'agent_execution',
      targetId: execution.id,
      requestedByUserId: tenant.userId,
      idempotencyKey: executionJobId(execution.id),
      requestId: meta.requestId ?? undefined,
      enqueuedAt: new Date().toISOString(),
    });
    return { mode: 'async', execution: toAgentExecution(execution) };
  }

  async list(
    tenant: TenantContext,
    query: ListAgentExecutionsQuery,
  ): Promise<PageResult<AgentExecutionDto>> {
    const where: Prisma.AgentExecutionWhereInput = {
      organizationId: tenant.organizationId,
      ...(query.agentId ? { agentId: query.agentId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.trigger ? { trigger: query.trigger } : {}),
      ...(query.rootOnly ? { parentExecutionId: null } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.agentExecution.findMany({
        where,
        include: EXECUTION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.agentExecution.count({ where }),
    ]);
    return page(rows.map(toAgentExecution), query, total);
  }

  async detail(tenant: TenantContext, id: string): Promise<AgentExecutionDetail> {
    const row = await this.requireExecution(tenant, id);
    const [steps, children] = await Promise.all([
      this.prisma.client.agentExecutionStep.findMany({
        where: { executionId: row.id },
        orderBy: { index: 'asc' },
      }),
      this.prisma.client.agentExecution.findMany({
        where: { parentExecutionId: row.id, organizationId: tenant.organizationId },
        include: EXECUTION_INCLUDE,
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return toAgentExecutionDetail(row, steps, children);
  }

  /**
   * queued → cancelled immediately (and the queued job is removed when still waiting);
   * running → cooperative cancellation flag (the runner stops before its next step);
   * finished → 409.
   */
  async cancel(tenant: TenantContext, id: string, meta: RequestMeta): Promise<AgentExecutionDto> {
    const row = await this.requireExecution(tenant, id);
    const decision = AgentRules.cancelDecision(row.status);
    let result: ExecutionRow = row;
    if (decision === 'cancel_now') {
      const now = new Date();
      // Conditional update: a worker may have picked the job up in the meantime.
      const claimed = await this.prisma.client.agentExecution.updateMany({
        where: { id: row.id, status: 'queued' },
        data: {
          status: 'cancelled',
          error: 'Cancelled by user',
          finishedAt: now,
          durationMs: 0,
        },
      });
      if (claimed.count === 0) {
        await this.cancellation.requestCancel(row.id);
      } else {
        await this.removeQueuedJob(row.id);
      }
      result = (await this.requireExecution(tenant, row.id)) as ExecutionRow;
    } else {
      await this.cancellation.requestCancel(row.id);
    }
    await this.audit.log({
      action: AuditAction.AGENT_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'agent_execution',
      targetId: row.id,
      metadata: { kind: 'cancel', previousStatus: row.status, decision },
      request: meta,
    });
    return toAgentExecution(result);
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private async requireExecution(tenant: TenantContext, id: string): Promise<ExecutionRow> {
    const row = await this.prisma.client.agentExecution.findFirst({
      where: { id, organizationId: tenant.organizationId },
      include: EXECUTION_INCLUDE,
    });
    if (!row) throw AppException.notFound('Agent execution');
    return row;
  }

  private async organizationName(organizationId: string): Promise<string | undefined> {
    const org = await this.prisma.client.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    return org?.name;
  }

  /** Best effort: drop the BullMQ job so the worker never sees it (it also re-checks the status). */
  private async removeQueuedJob(executionId: string): Promise<void> {
    try {
      const job = await this.queue.getQueue(QueueName.AI_TASKS).getJob(executionJobId(executionId));
      if (!job) return;
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed' || state === 'prioritized') await job.remove();
    } catch (error) {
      this.logger.warn(
        { err: error, executionId },
        'Could not remove queued agent execution job',
        AgentExecutionsService.name,
      );
    }
  }
}
