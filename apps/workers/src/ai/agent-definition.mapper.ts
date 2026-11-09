import {
  agentPermissionsSchema,
  agentRetryPolicySchema,
  type AgentPermissions,
  type AgentRetryPolicy,
} from '@hilatech/contracts';
import type { AgentDefinition } from '@hilatech/ai-engine';
import type { Agent } from '@hilatech/database';

/** The `Agent` columns the mapper needs (a full Prisma row satisfies it). */
export type AgentRow = Pick<
  Agent,
  | 'id'
  | 'organizationId'
  | 'name'
  | 'instructions'
  | 'providerConfigId'
  | 'model'
  | 'temperature'
  | 'maxOutputTokens'
  | 'tools'
  | 'permissions'
  | 'knowledgeBaseIds'
  | 'maxSteps'
  | 'maxDurationMs'
  | 'maxTokens'
  | 'maxDelegations'
  | 'retryPolicy'
  | 'isEnabled'
>;

/** Contract defaults for an empty permissions object (`allowWrite: false`, no delegation). */
export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = agentPermissionsSchema.parse({});
/** Contract defaults for an empty retry policy (`maxAttempts: 2`, `backoffMs: 2000`). */
export const DEFAULT_AGENT_RETRY_POLICY: AgentRetryPolicy = agentRetryPolicySchema.parse({});

/**
 * Parse a JSON column with its contract schema. Anything that is not a valid object (null, array,
 * string, wrong field types) falls back to the contract defaults — a malformed row written by an
 * older version must not stop every execution of the agent; the runner still enforces hard limits.
 */
export function parseAgentPermissions(value: unknown): AgentPermissions {
  const parsed = agentPermissionsSchema.safeParse(isPlainObject(value) ? value : {});
  return parsed.success ? parsed.data : DEFAULT_AGENT_PERMISSIONS;
}

export function parseAgentRetryPolicy(value: unknown): AgentRetryPolicy {
  const parsed = agentRetryPolicySchema.safeParse(isPlainObject(value) ? value : {});
  return parsed.success ? parsed.data : DEFAULT_AGENT_RETRY_POLICY;
}

/** Map an `Agent` row to the engine's `AgentDefinition` (the API performs the same mapping). */
export function toAgentDefinition(row: AgentRow): AgentDefinition {
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
    retryPolicy: parseAgentRetryPolicy(row.retryPolicy),
    isEnabled: row.isEnabled,
  };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
