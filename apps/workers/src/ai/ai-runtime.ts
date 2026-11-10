import { Inject, Injectable } from '@nestjs/common';
import {
  AgentRunner,
  EmbeddingService,
  PgVectorKnowledgeSearcher,
  PgVectorStore,
  PricingTable,
  PrismaExecutionStore,
  PrismaUsageRecorder,
  ProviderResolver,
  ToolRegistry,
  createKnowledgeSearchTool,
  crmTools,
  salesTools,
  timeNowTool,
  type AgentDefinition,
  type CancellationSignal,
  type KnowledgeSearcher,
  type ResolveOptions,
  type ResolvedModel,
} from '@hilatech/ai-engine';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { outboundPolicyFor } from '../automation/outbound-policy';
import { toAgentDefinition } from './agent-definition.mapper';
import { toEngineLogger } from './engine-logger';
import { RedisCancellationSignal } from './redis-cancellation.signal';
import { createToolAuditHook } from './tool-audit';

/**
 * The part of `ProviderResolver` the workers use. It is a separate injection token so tests can swap
 * in a scripted `MockProvider` without touching the organization's stored configuration.
 */
export interface ModelResolver {
  forOrganization(organizationId: string, options?: ResolveOptions): Promise<ResolvedModel>;
  forAgent(agent: AgentDefinition): Promise<ResolvedModel>;
}

export const AI_MODEL_RESOLVER = Symbol('AI_MODEL_RESOLVER');

/** Env keys the runtime reads — narrow so tests can pass a literal. */
export type AiRuntimeEnv = Pick<
  WorkersEnv,
  | 'NODE_ENV'
  | 'CREDENTIALS_ENCRYPTION_KEY'
  | 'AI_ALLOW_MOCK_PROVIDER'
  | 'AI_PRICING_JSON'
  | 'AI_TOOL_TIMEOUT_MS'
> &
  Partial<Pick<WorkersEnv, 'OUTBOUND_ALLOWED_HOSTS'>>;

/** Builds the production `ProviderResolver` from the validated environment. */
export function createProviderResolver(prisma: PrismaService, env: AiRuntimeEnv): ProviderResolver {
  return new ProviderResolver(prisma.client, {
    encryptionKey: env.CREDENTIALS_ENCRYPTION_KEY,
    // Tenant-supplied provider endpoints obey the same SSRF policy as webhooks and workflow HTTP steps.
    outboundPolicy: outboundPolicyFor({
      NODE_ENV: env.NODE_ENV,
      OUTBOUND_ALLOWED_HOSTS: env.OUTBOUND_ALLOWED_HOSTS ?? [],
    }),
    providerOptions: { nodeEnv: env.NODE_ENV, allowMock: env.AI_ALLOW_MOCK_PROVIDER },
  });
}

/** The shared tool catalogue: CRM tools, `time.now` and the permission-gated `knowledge.search`. */
export function createToolRegistry(knowledge: KnowledgeSearcher | null = null): ToolRegistry {
  return new ToolRegistry().registerAll([
    ...crmTools,
    ...salesTools,
    timeNowTool,
    createKnowledgeSearchTool(knowledge),
  ]);
}

/**
 * Everything the `ai-tasks` processor needs from `@hilatech/ai-engine`, wired once per process exactly
 * as the API wires it conceptually (ADR-009): provider resolution, tool registry, pricing, the two
 * persistence ports and the `AgentRunner`. The runner is re-entrant, so one instance serves every
 * concurrent job.
 */
@Injectable()
export class AiRuntime {
  readonly registry: ToolRegistry;
  readonly embeddings: EmbeddingService;
  readonly knowledgeSearcher: PgVectorKnowledgeSearcher;
  readonly pricing: PricingTable;
  readonly usage: PrismaUsageRecorder;
  readonly store: PrismaExecutionStore;
  readonly runner: AgentRunner;

  constructor(
    readonly prisma: PrismaService,
    @Inject(WORKERS_ENV) env: AiRuntimeEnv,
    @Inject(AI_MODEL_RESOLVER) readonly resolver: ModelResolver,
    cancellation: RedisCancellationSignal,
    @InjectPinoLogger(AiRuntime.name) private readonly logger: PinoLogger,
  ) {
    const engineLogger = toEngineLogger(logger);
    const { table, error } = PricingTable.fromJson(env.AI_PRICING_JSON);
    if (error) {
      this.logger.warn({ error }, 'AI_PRICING_JSON is invalid; cost estimates will be null');
    }
    this.pricing = table;

    this.usage = new PrismaUsageRecorder(prisma.client, {
      pricing: this.pricing,
      logger: engineLogger,
    });
    // Embeddings (document ingestion, knowledge.search) go through the organization's embedding provider
    // and are recorded as `operation: 'embed'` usage.
    this.embeddings = new EmbeddingService(this.resolver, this.usage, engineLogger);
    this.knowledgeSearcher = new PgVectorKnowledgeSearcher(
      this.embeddings,
      new PgVectorStore(prisma.client),
    );
    this.registry = createToolRegistry(this.knowledgeSearcher);
    this.store = new PrismaExecutionStore(prisma.client, cancellation as CancellationSignal);
    this.runner = new AgentRunner({
      prisma: prisma.client,
      logger: engineLogger,
      registry: this.registry,
      store: this.store,
      usage: this.usage,
      resolveModel: (agent) => this.resolver.forAgent(agent),
      loadAgent: (organizationId, agentId) => this.loadAgent(organizationId, agentId),
      onToolOutcome: createToolAuditHook(prisma.client, logger),
      toolTimeoutMs: env.AI_TOOL_TIMEOUT_MS,
    });
    this.logger.info(
      { tools: this.registry.keys().length, pricedModels: this.pricing.size() },
      'AI runtime ready',
    );
  }

  /** Load an organization's agent as an `AgentDefinition` (used for delegation targets). */
  async loadAgent(organizationId: string, agentId: string): Promise<AgentDefinition | null> {
    const row = await this.prisma.client.agent.findFirst({
      where: { id: agentId, organizationId },
    });
    return row ? toAgentDefinition(row) : null;
  }
}
