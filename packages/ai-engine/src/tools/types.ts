import type { Permission, ToolRiskLevel } from '@hilatech/contracts';
import type { PrismaClient } from '@hilatech/database';
import type { ZodTypeAny, z } from 'zod';

/** Minimal logger surface so the engine works with pino, Nest's Logger or console. */
export interface EngineLogger {
  debug(obj: Record<string, unknown>, msg?: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export const noopLogger: EngineLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Everything a tool needs. Tools MUST scope every query by `organizationId`. */
export interface ToolContext {
  organizationId: string;
  /** The human on whose behalf we act (assistant, manual agent run). Null for automation/schedule triggers. */
  userId: string | null;
  agentId: string | null;
  executionId: string | null;
  prisma: PrismaClient;
  logger: EngineLogger;
  signal: AbortSignal;
  now: () => Date;
}

export interface ToolResult {
  ok: boolean;
  /** Serialisable payload returned to the model (kept small). */
  data?: unknown;
  /** Short human-readable summary for logs/UI. */
  summary: string;
  error?: string;
}

export interface ToolDefinition<TInput extends ZodTypeAny = ZodTypeAny> {
  /** Stable key, e.g. `crm.search_leads`. Also the function name the model sees. */
  key: string;
  name: string;
  description: string;
  category: string;
  riskLevel: ToolRiskLevel;
  /** Permission the executing principal must hold (null for harmless utilities). */
  requiredPermission: Permission | null;
  input: TInput;
  /** Per-call timeout; defaults to the executor's default. */
  timeoutMs?: number;
  execute(ctx: ToolContext, input: z.infer<TInput>): Promise<ToolResult>;
}

/** Who is executing and what they are allowed to do. */
export interface ToolPrincipal {
  /** Tool keys the caller may use (agent.tools or the assistant default set). */
  allowedTools: readonly string[];
  /** Effective permissions (user's tenant permissions, possibly intersected with agent grants). */
  permissions: readonly string[];
  /** Whether `write` tools may run. */
  allowWrite: boolean;
}
