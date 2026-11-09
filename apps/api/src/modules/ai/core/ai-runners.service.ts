import {
  type AgentDefinition,
  AgentRunner,
  type EngineLogger,
  type ExecutionStore,
  PrismaExecutionStore,
  PrismaUsageRecorder,
  ProviderResolver,
  type RunnerDeps,
  type ToolOutcome,
  ToolRegistry,
} from '@hilatech/ai-engine';
import { AuditAction } from '@hilatech/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfig } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { toAgentDefinition } from '../agents/agents.mappers';
import { ENGINE_LOGGER } from './engine-logger';
import { NoopExecutionStore } from './noop-execution-store';

export type RunnerPrincipalKind = 'agent' | 'assistant';

/**
 * The two `AgentRunner` instances the API uses:
 *  - `agents`: real `Agent` rows → steps and results persisted through `PrismaExecutionStore` (sync mode);
 *  - `assistant`: the implicit assistant agent → `NoopExecutionStore` (transcript lives in `AssistantMessage`).
 * Both audit every tool outcome and resolve providers/tools through the shared engine providers.
 */
@Injectable()
export class AiRunnersService {
  readonly agents: AgentRunner;
  readonly assistant: AgentRunner;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: AppConfig,
    @Inject(ENGINE_LOGGER) logger: EngineLogger,
    registry: ToolRegistry,
    resolver: ProviderResolver,
    usage: PrismaUsageRecorder,
    store: PrismaExecutionStore,
  ) {
    const shared: Omit<RunnerDeps, 'store' | 'onToolOutcome' | 'loadAgent'> = {
      prisma: prisma.client,
      logger,
      registry,
      usage,
      resolveModel: (agent) => resolver.forAgent(agent),
      toolTimeoutMs: config.get('AI_TOOL_TIMEOUT_MS'),
    };
    this.agents = this.createRunner({
      ...shared,
      store,
      loadAgent: (organizationId, agentId) => this.loadAgent(organizationId, agentId),
      kind: 'agent',
    });
    this.assistant = this.createRunner({
      ...shared,
      store: new NoopExecutionStore(),
      // The assistant's synthetic agent id is the thread id: it must not land in the `agentId` /
      // `executionId` foreign keys of AiRequestLog — attribution goes through `threadId`.
      usage: { record: (entry) => usage.record({ ...entry, agentId: null, executionId: null }) },
      // The assistant never delegates (allowDelegation=false); nothing to load.
      loadAgent: async () => null,
      kind: 'assistant',
    });
  }

  private createRunner(
    deps: Omit<RunnerDeps, 'onToolOutcome'> & { store: ExecutionStore; kind: RunnerPrincipalKind },
  ): AgentRunner {
    const { kind, ...runnerDeps } = deps;
    return new AgentRunner({
      ...runnerDeps,
      onToolOutcome: (params) => this.auditToolOutcome(kind, params),
    });
  }

  /** Agents of the same organization only — delegation can never cross tenants. */
  async loadAgent(organizationId: string, agentId: string): Promise<AgentDefinition | null> {
    const row = await this.prisma.client.agent.findFirst({
      where: { id: agentId, organizationId },
    });
    return row ? toAgentDefinition(row) : null;
  }

  private async auditToolOutcome(
    kind: RunnerPrincipalKind,
    params: {
      organizationId: string;
      userId: string | null;
      agentId: string;
      executionId: string;
      toolKey: string;
      outcome: ToolOutcome;
    },
  ): Promise<void> {
    const { outcome } = params;
    const denied = outcome.status === 'denied' || outcome.status === 'requires_authorization';
    await this.audit.log({
      action: denied ? AuditAction.AI_TOOL_DENIED : AuditAction.AI_TOOL_EXECUTED,
      organizationId: params.organizationId,
      actorUserId: params.userId,
      targetType: kind === 'agent' ? 'agent_execution' : 'assistant_thread',
      targetId: params.executionId,
      metadata: {
        toolKey: params.toolKey,
        status: outcome.status,
        reason:
          outcome.status === 'denied'
            ? outcome.reason
            : outcome.status === 'requires_authorization'
              ? 'requires_authorization'
              : outcome.status === 'error'
                ? (outcome.result.error ?? 'error')
                : null,
        summary: outcome.result.summary,
        durationMs: outcome.durationMs,
        ...(kind === 'agent' ? { agentId: params.agentId } : { threadId: params.agentId }),
      },
    });
  }
}
