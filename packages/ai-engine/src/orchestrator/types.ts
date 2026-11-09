import type {
  AgentPermissions,
  AgentRetryPolicy,
  AgentStepType,
  AgentTrigger,
  AiOperation,
  AiProviderKind,
  AiRequestStatus,
} from '@hilatech/contracts';
import type { PrismaClient } from '@hilatech/database';

import type { AiMessage, AiProvider, TokenUsage, ToolCall } from '../providers/types';
import type { ToolOutcome } from '../tools/executor';
import type { ToolRegistry } from '../tools/registry';
import type { EngineLogger } from '../tools/types';

/** The subset of an `Agent` row the runner needs (the API maps Prisma rows to this). */
export interface AgentDefinition {
  id: string;
  organizationId: string;
  name: string;
  instructions: string;
  providerConfigId: string | null;
  model: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
  tools: string[];
  permissions: AgentPermissions;
  knowledgeBaseIds: string[];
  maxSteps: number;
  maxDurationMs: number;
  maxTokens: number;
  maxDelegations: number;
  retryPolicy: AgentRetryPolicy;
  isEnabled: boolean;
}

export interface ResolvedModel {
  provider: AiProvider;
  providerKind: AiProviderKind;
  providerConfigId: string | null;
  model: string;
  contextWindow: number;
  /** Embedding model configured on the provider config, if any. */
  embeddingModel?: string | null;
}

export interface StepRecord {
  index: number;
  type: AgentStepType;
  name: string | null;
  input: unknown;
  output: unknown;
  status: 'succeeded' | 'failed' | 'denied' | 'requires_authorization';
  error: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type RunStatus = 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

export interface ExecutionFinish {
  status: RunStatus;
  output: unknown;
  error: string | null;
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  finishedAt: Date;
  durationMs: number;
}

/** Persistence port implemented by the API/workers with Prisma (`AgentExecution`, `AgentExecutionStep`). */
export interface ExecutionStore {
  markRunning(executionId: string, startedAt: Date): Promise<void>;
  addStep(executionId: string, step: StepRecord): Promise<void>;
  finish(executionId: string, result: ExecutionFinish): Promise<void>;
  createChild(params: {
    organizationId: string;
    agentId: string;
    parentExecutionId: string;
    rootExecutionId: string;
    depth: number;
    input: unknown;
    triggeredByUserId: string | null;
  }): Promise<{ id: string }>;
  /** Cooperative cancellation: polled between steps. */
  isCancelled(executionId: string): Promise<boolean>;
}

export interface UsageEntry {
  organizationId: string;
  userId: string | null;
  agentId: string | null;
  executionId: string | null;
  threadId: string | null;
  provider: AiProviderKind;
  model: string;
  operation: AiOperation;
  status: AiRequestStatus;
  usage: TokenUsage;
  durationMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

/** Usage port: persists `AiRequestLog`, updates entitlements, estimates cost when pricing is known. */
export interface UsageRecorder {
  record(entry: UsageEntry): Promise<{ estimatedCostUsd: number | null }>;
}

/** Shared budget for a whole execution tree; children consume from the root's budget. */
export interface Budget {
  deadlineAt: number;
  tokens: { used: number; max: number };
  delegations: { used: number; max: number };
}

export type RunEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'tool_result'; toolCall: ToolCall; outcome: ToolOutcome }
  | { type: 'step'; step: StepRecord }
  | { type: 'delegation'; executionId: string; agentId: string; status: RunStatus };

export interface RunRequest {
  executionId: string;
  agent: AgentDefinition;
  /** The task (agents) or the newest user message (assistant). */
  input: string | Record<string, unknown>;
  /** Prior turns (assistant threads). Oldest first. */
  history?: AiMessage[];
  /** Rolling summary of older history. */
  summary?: string | null;
  /** Human on whose behalf we run; null for automation/schedule. */
  userId: string | null;
  /** The user's tenant permissions when there is a user. */
  userPermissions: readonly string[] | null;
  trigger: AgentTrigger;
  depth: number;
  rootExecutionId: string;
  /** Agent ids from the root down to (excluding) this agent — for cycle detection. */
  ancestry: string[];
  budget?: Budget;
  /** Caps applied on top of the agent's own limits (sync mode). */
  caps?: Partial<Pick<AgentDefinition, 'maxSteps' | 'maxDurationMs' | 'maxTokens'>>;
  /** Streams deltas/tool events (assistant UI). */
  stream?: boolean;
  onEvent?: (event: RunEvent) => void;
  signal?: AbortSignal;
  /** Prompt context. */
  organizationName?: string;
  userName?: string | null;
  locale?: string;
  /** Extra data blocks appended to the system prompt (already wrapped with `dataBlock`). */
  dataBlocks?: string[];
  /** Thread id for usage attribution (assistant). */
  threadId?: string | null;
}

export interface RunResult {
  status: RunStatus;
  output: string | null;
  error: string | null;
  stepCount: number;
  usage: TokenUsage;
  durationMs: number;
  estimatedCostUsd: number | null;
  /** New messages produced in this run (assistant persists them). */
  transcript: AiMessage[];
}

export interface RunnerDeps {
  prisma: PrismaClient;
  logger: EngineLogger;
  registry: ToolRegistry;
  store: ExecutionStore;
  usage: UsageRecorder;
  resolveModel(agent: AgentDefinition): Promise<ResolvedModel>;
  /** Load another agent of the same organization (delegation). */
  loadAgent(organizationId: string, agentId: string): Promise<AgentDefinition | null>;
  /** Audit hook for tool outcomes (optional). */
  onToolOutcome?: (params: {
    organizationId: string;
    userId: string | null;
    agentId: string;
    executionId: string;
    toolKey: string;
    outcome: ToolOutcome;
  }) => void | Promise<void>;
  now?: () => Date;
  /** Default per-tool timeout. */
  toolTimeoutMs?: number;
}
