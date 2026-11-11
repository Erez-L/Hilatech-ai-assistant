import { z } from 'zod';
import {
  idSchema,
  paginationQuerySchema,
  sortOrderSchema,
  timestampsSchema,
  userSummarySchema,
  partialUpdate,
} from './common';

// ---------------------------------------------------------------------------
// Providers & configuration
// ---------------------------------------------------------------------------

/**
 * `bedrock` is Amazon Bedrock (Converse API). It authenticates with the AWS default credential chain
 * (IAM role / SSO profile) — no API key is stored for it.
 * `mock` is a deterministic in-process provider for tests and local development. It is refused in production. */
export const AiProviderKind = z.enum(['anthropic', 'openai', 'bedrock', 'mock']);
export type AiProviderKind = z.infer<typeof AiProviderKind>;

export const AiHealthStatus = z.enum(['unknown', 'ok', 'error']);
export type AiHealthStatus = z.infer<typeof AiHealthStatus>;

/** Provider configuration as returned to clients. The API key is never returned — only its last 4 characters. */
export const aiProviderConfigSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    provider: AiProviderKind,
    name: z.string(),
    keyLast4: z.string().nullable(),
    hasApiKey: z.boolean(),
    baseUrl: z.string().nullable(),
    /** AWS region (bedrock only). Null falls back to the server's AWS_REGION / profile region. */
    region: z.string().nullable().optional(),
    defaultModel: z.string(),
    embeddingModel: z.string().nullable(),
    isDefault: z.boolean(),
    isEnabled: z.boolean(),
    lastHealthStatus: AiHealthStatus,
    lastHealthCheckAt: z.string().datetime().nullable(),
    lastHealthError: z.string().nullable(),
  })
  .merge(timestampsSchema);
export type AiProviderConfig = z.infer<typeof aiProviderConfigSchema>;

export const createAiProviderConfigSchema = z.object({
  provider: AiProviderKind,
  name: z.string().trim().min(1).max(80),
  /** Write-only. Required for anthropic/openai; not used for bedrock (IAM) or mock. */
  apiKey: z.string().trim().min(8).max(512).optional(),
  baseUrl: z.string().trim().url().optional(),
  /** AWS region such as `us-east-1` (bedrock only; ignored by other providers). */
  region: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[a-z]+)+-\d$/, 'Expected an AWS region such as us-east-1')
    .optional(),
  defaultModel: z.string().trim().min(1).max(120),
  embeddingModel: z.string().trim().min(1).max(120).optional(),
  isDefault: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
});
export type CreateAiProviderConfigRequest = z.infer<typeof createAiProviderConfigSchema>;

export const updateAiProviderConfigSchema = partialUpdate(
  createAiProviderConfigSchema.omit({ provider: true }),
).extend({
  /** Set to true to remove the stored key (the config becomes unusable until a new key is set). */
  clearApiKey: z.boolean().optional(),
});
export type UpdateAiProviderConfigRequest = z.infer<typeof updateAiProviderConfigSchema>;

export const aiModelInfoSchema = z.object({
  id: z.string(),
  provider: AiProviderKind,
  displayName: z.string(),
  contextWindow: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  supportsTools: z.boolean(),
  supportsStreaming: z.boolean(),
  supportsStructuredOutput: z.boolean(),
  supportsEmbeddings: z.boolean(),
  /** Set when the catalogue entry has not been verified against a live account (e.g. Bedrock regional availability). */
  availabilityNote: z.string().optional(),
});
export type AiModelInfo = z.infer<typeof aiModelInfoSchema>;

export const aiHealthCheckResultSchema = z.object({
  status: AiHealthStatus,
  checkedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
});
export type AiHealthCheckResult = z.infer<typeof aiHealthCheckResultSchema>;

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export const AiOperation = z.enum(['generate', 'stream', 'structured', 'embed']);
export type AiOperation = z.infer<typeof AiOperation>;
export const AiRequestStatus = z.enum(['success', 'error', 'timeout', 'cancelled']);
export type AiRequestStatus = z.infer<typeof AiRequestStatus>;

export const aiRequestLogSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  userId: idSchema.nullable(),
  agentId: idSchema.nullable(),
  executionId: idSchema.nullable(),
  threadId: idSchema.nullable(),
  provider: AiProviderKind,
  model: z.string(),
  operation: AiOperation,
  status: AiRequestStatus,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  /** Null when no pricing configuration exists for the model — never an invented figure. */
  estimatedCostUsd: z.number().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AiRequestLog = z.infer<typeof aiRequestLogSchema>;

export const listAiRequestLogsQuerySchema = paginationQuerySchema.extend({
  agentId: idSchema.optional(),
  userId: idSchema.optional(),
  provider: AiProviderKind.optional(),
  status: AiRequestStatus.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListAiRequestLogsQuery = z.infer<typeof listAiRequestLogsQuerySchema>;

export const aiUsageSummarySchema = z.object({
  period: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  /** Null when any request in the period lacks pricing. */
  estimatedCostUsd: z.number().nullable(),
  errorCount: z.number().int().nonnegative(),
  byModel: z.array(
    z.object({
      provider: AiProviderKind,
      model: z.string(),
      requests: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      estimatedCostUsd: z.number().nullable(),
    }),
  ),
  byAgent: z.array(
    z.object({
      agentId: idSchema.nullable(),
      agentName: z.string().nullable(),
      requests: z.number().int(),
      totalTokens: z.number().int(),
    }),
  ),
  /** Plan limit for AI tokens in the current period, if any. */
  limit: z.object({ tokens: z.number().int().nullable(), used: z.number().int() }),
});
export type AiUsageSummary = z.infer<typeof aiUsageSummarySchema>;

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

export const promptTemplateSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    content: z.string(),
    variables: z.array(z.string()),
    isSystem: z.boolean(),
    version: z.number().int().positive(),
  })
  .merge(timestampsSchema);
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

export const createPromptTemplateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9_.-]*$/, 'lowercase letters, digits, "_", "." and "-" only'),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  content: z.string().min(1).max(50_000),
});
export type CreatePromptTemplateRequest = z.infer<typeof createPromptTemplateSchema>;
export const updatePromptTemplateSchema = partialUpdate(
  createPromptTemplateSchema.omit({ key: true }),
);
export type UpdatePromptTemplateRequest = z.infer<typeof updatePromptTemplateSchema>;

export const renderPromptTemplateSchema = z.object({
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type RenderPromptTemplateRequest = z.infer<typeof renderPromptTemplateSchema>;

// ---------------------------------------------------------------------------
// Tools (the permission-controlled capabilities assistants and agents may call)
// ---------------------------------------------------------------------------

export const ToolRiskLevel = z.enum(['read', 'write', 'dangerous']);
export type ToolRiskLevel = z.infer<typeof ToolRiskLevel>;

export const toolDefinitionSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  riskLevel: ToolRiskLevel,
  /** Permission (from `Permission`) the executing principal must hold. */
  requiredPermission: z.string().nullable(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

// ---------------------------------------------------------------------------
// Assistant (interactive chat)
// ---------------------------------------------------------------------------

export const AssistantRole = z.enum(['user', 'assistant', 'system', 'tool']);
export type AssistantRole = z.infer<typeof AssistantRole>;

export const assistantThreadSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    userId: idSchema,
    title: z.string().nullable(),
    providerConfigId: idSchema.nullable(),
    model: z.string().nullable(),
    messageCount: z.number().int().nonnegative(),
    lastMessageAt: z.string().datetime().nullable(),
  })
  .merge(timestampsSchema);
export type AssistantThread = z.infer<typeof assistantThreadSchema>;

export const createAssistantThreadSchema = z.object({
  title: z.string().trim().max(200).optional(),
  providerConfigId: idSchema.optional(),
  model: z.string().trim().max(120).optional(),
});
export type CreateAssistantThreadRequest = z.infer<typeof createAssistantThreadSchema>;
export const updateAssistantThreadSchema = partialUpdate(createAssistantThreadSchema);
export type UpdateAssistantThreadRequest = z.infer<typeof updateAssistantThreadSchema>;

export const assistantMessageSchema = z.object({
  id: idSchema,
  threadId: idSchema,
  role: AssistantRole,
  content: z.string(),
  toolCalls: z.array(toolCallSchema).nullable(),
  toolCallId: z.string().nullable(),
  toolName: z.string().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const sendAssistantMessageSchema = z.object({
  content: z.string().trim().min(1).max(50_000),
  /** Optional CRM context the UI is currently showing (e.g. the open lead) — passed to the model as data, never as instructions. */
  context: z
    .object({
      leadId: idSchema.optional(),
      contactId: idSchema.optional(),
      conversationId: idSchema.optional(),
    })
    .optional(),
});
export type SendAssistantMessageRequest = z.infer<typeof sendAssistantMessageSchema>;

export const listAssistantMessagesQuerySchema = paginationQuerySchema.extend({
  sortOrder: sortOrderSchema.default('asc'),
});
export type ListAssistantMessagesQuery = z.infer<typeof listAssistantMessagesQuerySchema>;

/** Server-sent events emitted while the assistant answers (`POST .../messages` with `Accept: text/event-stream`). */
export const assistantStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message_start'), messageId: idSchema }),
  z.object({ type: z.literal('text_delta'), delta: z.string() }),
  z.object({ type: z.literal('tool_call'), toolCall: toolCallSchema }),
  z.object({
    type: z.literal('tool_result'),
    toolCallId: z.string(),
    name: z.string(),
    ok: z.boolean(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal('message_end'),
    message: assistantMessageSchema,
    usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int() }),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type AssistantStreamEvent = z.infer<typeof assistantStreamEventSchema>;

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const agentPermissionsSchema = z.object({
  /** Allow tools with riskLevel `write`. `dangerous` tools are never executed autonomously. */
  allowWrite: z.boolean().default(false),
  /** Allow delegating sub-tasks to other agents (`agents.delegate` tool). */
  allowDelegation: z.boolean().default(false),
  /** Agent ids this agent may delegate to. Empty with allowDelegation=true means any enabled agent in the organization. */
  delegateTo: z.array(idSchema).default([]),
});
export type AgentPermissions = z.infer<typeof agentPermissionsSchema>;

export const agentRetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5).default(2),
  backoffMs: z.number().int().min(0).max(60_000).default(2000),
});
export type AgentRetryPolicy = z.infer<typeof agentRetryPolicySchema>;

export const agentSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    name: z.string(),
    description: z.string().nullable(),
    instructions: z.string(),
    providerConfigId: idSchema.nullable(),
    model: z.string().nullable(),
    temperature: z.number().nullable(),
    maxOutputTokens: z.number().int().nullable(),
    tools: z.array(z.string()),
    permissions: agentPermissionsSchema,
    knowledgeBaseIds: z.array(idSchema),
    maxSteps: z.number().int(),
    maxDurationMs: z.number().int(),
    maxTokens: z.number().int(),
    maxDelegations: z.number().int(),
    retryPolicy: agentRetryPolicySchema,
    isEnabled: z.boolean(),
    createdById: idSchema.nullable(),
    createdBy: userSummarySchema.nullable(),
  })
  .merge(timestampsSchema);
export type Agent = z.infer<typeof agentSchema>;

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  instructions: z.string().trim().min(1).max(50_000),
  providerConfigId: idSchema.optional(),
  model: z.string().trim().max(120).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(16).max(64_000).optional(),
  tools: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  permissions: agentPermissionsSchema.prefault({}),
  knowledgeBaseIds: z.array(idSchema).max(20).default([]),
  maxSteps: z.number().int().min(1).max(50).default(12),
  maxDurationMs: z.number().int().min(1000).max(900_000).default(120_000),
  maxTokens: z.number().int().min(1000).max(2_000_000).default(150_000),
  maxDelegations: z.number().int().min(0).max(10).default(3),
  retryPolicy: agentRetryPolicySchema.prefault({}),
  isEnabled: z.boolean().default(true),
});
export type CreateAgentRequest = z.infer<typeof createAgentSchema>;
export const updateAgentSchema = partialUpdate(createAgentSchema);
export type UpdateAgentRequest = z.infer<typeof updateAgentSchema>;

export const listAgentsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  isEnabled: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type ListAgentsQuery = z.infer<typeof listAgentsQuerySchema>;

export const AgentExecutionStatus = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
]);
export type AgentExecutionStatus = z.infer<typeof AgentExecutionStatus>;
export const AgentTrigger = z.enum(['manual', 'api', 'automation', 'agent', 'schedule']);
export type AgentTrigger = z.infer<typeof AgentTrigger>;
export const AgentStepType = z.enum(['llm_call', 'tool_call', 'delegation', 'final', 'error']);
export type AgentStepType = z.infer<typeof AgentStepType>;

export const agentExecutionStepSchema = z.object({
  id: idSchema,
  executionId: idSchema,
  index: z.number().int().nonnegative(),
  type: AgentStepType,
  name: z.string().nullable(),
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  status: z.string(),
  error: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});
export type AgentExecutionStep = z.infer<typeof agentExecutionStepSchema>;

export const agentExecutionSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    agentId: idSchema,
    agent: z.object({ id: idSchema, name: z.string() }).nullable(),
    parentExecutionId: idSchema.nullable(),
    rootExecutionId: idSchema.nullable(),
    triggeredByUserId: idSchema.nullable(),
    trigger: AgentTrigger,
    status: AgentExecutionStatus,
    input: z.unknown(),
    output: z.unknown().nullable(),
    error: z.string().nullable(),
    depth: z.number().int().nonnegative(),
    stepCount: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nullable(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nullable(),
  })
  .merge(timestampsSchema);
export type AgentExecution = z.infer<typeof agentExecutionSchema>;

export const agentExecutionDetailSchema = agentExecutionSchema.extend({
  steps: z.array(agentExecutionStepSchema),
  children: z.array(agentExecutionSchema),
});
export type AgentExecutionDetail = z.infer<typeof agentExecutionDetailSchema>;

export const executeAgentSchema = z.object({
  /** Free-text task or a structured payload. */
  input: z.union([z.string().trim().min(1).max(50_000), z.record(z.string(), z.unknown())]),
  /**
   * `async` (default) enqueues the run on the `ai-tasks` queue and returns the queued execution;
   * `sync` runs inline with a short hard cap (for interactive testing) and returns the finished execution.
   */
  mode: z.enum(['async', 'sync']).default('async'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ExecuteAgentRequest = z.infer<typeof executeAgentSchema>;

export const listAgentExecutionsQuerySchema = paginationQuerySchema.extend({
  agentId: idSchema.optional(),
  status: AgentExecutionStatus.optional(),
  trigger: AgentTrigger.optional(),
  rootOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type ListAgentExecutionsQuery = z.infer<typeof listAgentExecutionsQuerySchema>;

/** Hard ceilings the orchestrator applies regardless of agent configuration. */
export const AGENT_HARD_LIMITS = {
  maxSteps: 50,
  maxDurationMs: 900_000,
  maxTokens: 2_000_000,
  maxDelegationDepth: 2,
  maxDelegationsPerExecution: 10,
  maxToolCallsPerStep: 8,
  syncModeMaxDurationMs: 60_000,
  syncModeMaxSteps: 8,
} as const;
