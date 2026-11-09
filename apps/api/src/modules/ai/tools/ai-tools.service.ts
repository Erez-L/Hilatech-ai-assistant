import { type ToolDefinition, ToolRegistry, inputJsonSchema } from '@hilatech/ai-engine';
import { Permission, type ToolDefinition as ToolDefinitionDto } from '@hilatech/contracts';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

export const DELEGATE_TOOL_KEY = 'agents.delegate';
export const DELEGATE_PARALLEL_TOOL_KEY = 'agents.delegate_parallel';
export const DELEGATION_TOOL_KEYS: readonly string[] = [
  DELEGATE_TOOL_KEY,
  DELEGATE_PARALLEL_TOOL_KEY,
];

const delegationTask = {
  agentId: z.string().uuid(),
  task: z.string().trim().min(1).max(20_000),
  context: z.record(z.string(), z.unknown()).optional(),
};

/**
 * Catalogue entries for the delegation tools. They are bound per run by `AgentRunner` (budget, cycle
 * checks) and are enabled through `permissions.allowDelegation`, not through `agent.tools`; they appear
 * in the catalogue so the UI can explain them. `execute` is never called from here.
 */
const DELEGATION_DESCRIPTORS: ToolDefinition[] = [
  {
    key: DELEGATE_TOOL_KEY,
    name: 'Delegate to agent',
    description:
      'Hand a well-defined sub-task to another agent of the organization and wait for its result. Enabled by permissions.allowDelegation.',
    category: 'agents',
    riskLevel: 'read',
    requiredPermission: Permission.AGENTS_EXECUTE,
    input: z.object(delegationTask),
    execute: async () => ({ ok: false, summary: 'descriptor only', error: 'not_executable' }),
  },
  {
    key: DELEGATE_PARALLEL_TOOL_KEY,
    name: 'Delegate in parallel',
    description:
      'Run several independent sub-tasks on other agents at the same time and aggregate their results. Enabled by permissions.allowDelegation.',
    category: 'agents',
    riskLevel: 'read',
    requiredPermission: Permission.AGENTS_EXECUTE,
    input: z.object({ tasks: z.array(z.object(delegationTask)).min(1).max(5) }),
    execute: async () => ({ ok: false, summary: 'descriptor only', error: 'not_executable' }),
  },
];

@Injectable()
export class AiToolsService {
  constructor(private readonly registry: ToolRegistry) {}

  /** Registry tools plus the delegation descriptors, sorted by category then key. */
  catalogue(): ToolDefinitionDto[] {
    const delegation: ToolDefinitionDto[] = DELEGATION_DESCRIPTORS.map((tool) => ({
      key: tool.key,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      riskLevel: tool.riskLevel,
      requiredPermission: tool.requiredPermission,
      inputSchema: inputJsonSchema(tool),
    }));
    return [...this.registry.toDtos(), ...delegation].sort(
      (a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key),
    );
  }

  /** Keys an agent may list in `tools` (delegation keys are stripped, unknown keys reported). */
  validateAgentTools(keys: readonly string[]): { tools: string[]; unknown: string[] } {
    const tools = [...new Set(keys.filter((k) => !DELEGATION_TOOL_KEYS.includes(k)))];
    return { tools, unknown: this.registry.unknownKeys(tools) };
  }
}
