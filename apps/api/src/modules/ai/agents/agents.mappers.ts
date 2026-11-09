import { type AgentDefinition } from '@hilatech/ai-engine';
import {
  type Agent as AgentDto,
  type AgentExecution as AgentExecutionDto,
  type AgentExecutionDetail,
  type AgentExecutionStep as AgentExecutionStepDto,
  type AgentPermissions,
  type AgentRetryPolicy,
  agentPermissionsSchema,
  agentRetryPolicySchema,
} from '@hilatech/contracts';
import {
  type Agent,
  type AgentExecution,
  type AgentExecutionStep,
  type Prisma,
} from '@hilatech/database';

import {
  USER_SUMMARY_SELECT,
  type UserSummaryRow,
  decimalToNumber,
  isoOrNull,
  toUserSummary,
} from '../../crm/crm.mappers';

// -----------------------------------------------------------------------------------------------
// JSON columns → validated contract shapes (defaults applied when the stored value is malformed)
// -----------------------------------------------------------------------------------------------

export function parseAgentPermissions(value: unknown): AgentPermissions {
  const parsed = agentPermissionsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : agentPermissionsSchema.parse({});
}

export function parseRetryPolicy(value: unknown): AgentRetryPolicy {
  const parsed = agentRetryPolicySchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : agentRetryPolicySchema.parse({});
}

/** The engine's view of an agent row. One mapper for the runner (`loadAgent`) and the API services. */
export function toAgentDefinition(row: Agent): AgentDefinition {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    instructions: row.instructions,
    providerConfigId: row.providerConfigId,
    model: row.model,
    temperature: row.temperature,
    maxOutputTokens: row.maxOutputTokens,
    tools: [...row.tools],
    permissions: parseAgentPermissions(row.permissions),
    knowledgeBaseIds: [...row.knowledgeBaseIds],
    maxSteps: row.maxSteps,
    maxDurationMs: row.maxDurationMs,
    maxTokens: row.maxTokens,
    maxDelegations: row.maxDelegations,
    retryPolicy: parseRetryPolicy(row.retryPolicy),
    isEnabled: row.isEnabled,
  };
}

// -----------------------------------------------------------------------------------------------
// API DTOs
// -----------------------------------------------------------------------------------------------

export const AGENT_INCLUDE = {
  createdBy: { select: USER_SUMMARY_SELECT },
} as const satisfies Prisma.AgentInclude;

export type AgentRow = Agent & { createdBy: UserSummaryRow | null };

export function toAgent(row: AgentRow): AgentDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    providerConfigId: row.providerConfigId,
    model: row.model,
    temperature: row.temperature,
    maxOutputTokens: row.maxOutputTokens,
    tools: [...row.tools],
    permissions: parseAgentPermissions(row.permissions),
    knowledgeBaseIds: [...row.knowledgeBaseIds],
    maxSteps: row.maxSteps,
    maxDurationMs: row.maxDurationMs,
    maxTokens: row.maxTokens,
    maxDelegations: row.maxDelegations,
    retryPolicy: parseRetryPolicy(row.retryPolicy),
    isEnabled: row.isEnabled,
    createdById: row.createdById,
    createdBy: toUserSummary(row.createdBy),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const EXECUTION_INCLUDE = {
  agent: { select: { id: true, name: true } },
} as const satisfies Prisma.AgentExecutionInclude;

export type ExecutionRow = AgentExecution & { agent: { id: string; name: string } | null };

export function toAgentExecution(row: ExecutionRow): AgentExecutionDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    agent: row.agent ? { id: row.agent.id, name: row.agent.name } : null,
    parentExecutionId: row.parentExecutionId,
    rootExecutionId: row.rootExecutionId,
    triggeredByUserId: row.triggeredByUserId,
    trigger: row.trigger,
    status: row.status,
    input: row.input,
    output: row.output ?? null,
    error: row.error,
    depth: row.depth,
    stepCount: row.stepCount,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    estimatedCostUsd: decimalToNumber(row.estimatedCostUsd),
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAgentExecutionStep(row: AgentExecutionStep): AgentExecutionStepDto {
  return {
    id: row.id,
    executionId: row.executionId,
    index: row.index,
    type: row.type,
    name: row.name,
    input: row.input ?? null,
    output: row.output ?? null,
    status: row.status,
    error: row.error,
    durationMs: row.durationMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAgentExecutionDetail(
  row: ExecutionRow,
  steps: AgentExecutionStep[],
  children: ExecutionRow[],
): AgentExecutionDetail {
  return {
    ...toAgentExecution(row),
    steps: steps.map(toAgentExecutionStep),
    children: children.map(toAgentExecution),
  };
}
