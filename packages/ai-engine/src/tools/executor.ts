import type { ToolCall } from '../providers/types';
import { fromFunctionName, type ToolRegistry } from './registry';
import type { ToolContext, ToolDefinition, ToolPrincipal, ToolResult } from './types';

export type ToolOutcome =
  | { status: 'ok'; toolKey: string; result: ToolResult; durationMs: number }
  | { status: 'error'; toolKey: string; result: ToolResult; durationMs: number }
  | {
      status: 'denied';
      toolKey: string;
      reason: 'unknown_tool' | 'not_allowed_for_agent' | 'missing_permission' | 'write_not_allowed' | 'invalid_input';
      result: ToolResult;
      durationMs: number;
    }
  | { status: 'requires_authorization'; toolKey: string; result: ToolResult; durationMs: number };

export interface ToolExecutorOptions {
  defaultTimeoutMs?: number;
  /** Called for every outcome (audit/metrics). Must not throw. */
  onOutcome?: (call: ToolCall, outcome: ToolOutcome, ctx: ToolContext) => void | Promise<void>;
}

/**
 * The permission layer in front of every tool call. Order of checks:
 *   1. tool exists   2. in caller's allow-list   3. required permission   4. write/dangerous policy
 *   5. input validation   6. execution with timeout
 * Nothing here throws to the orchestrator: every path returns a ToolOutcome the model can be told about.
 */
export class ToolExecutor {
  private readonly defaultTimeoutMs: number;
  private readonly onOutcome?: ToolExecutorOptions['onOutcome'];

  constructor(
    private readonly registry: ToolRegistry,
    options: ToolExecutorOptions = {},
  ) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15_000;
    this.onOutcome = options.onOutcome;
  }

  async execute(ctx: ToolContext, principal: ToolPrincipal, call: ToolCall): Promise<ToolOutcome> {
    const started = Date.now();
    const toolKey = fromFunctionName(call.name);
    const finish = async (outcome: ToolOutcome): Promise<ToolOutcome> => {
      try {
        await this.onOutcome?.(call, outcome, ctx);
      } catch (error) {
        ctx.logger.error({ err: error, toolKey }, 'tool outcome hook failed');
      }
      return outcome;
    };

    const tool = this.registry.get(toolKey);
    if (!tool) {
      return finish(denied(toolKey, 'unknown_tool', `Unknown tool "${toolKey}"`, started));
    }
    if (!principal.allowedTools.includes(toolKey)) {
      return finish(denied(toolKey, 'not_allowed_for_agent', `Tool "${toolKey}" is not enabled for this agent`, started));
    }
    if (tool.requiredPermission && !principal.permissions.includes(tool.requiredPermission)) {
      return finish(
        denied(toolKey, 'missing_permission', `Missing permission "${tool.requiredPermission}" for tool "${toolKey}"`, started),
      );
    }
    if (tool.riskLevel === 'dangerous') {
      return finish({
        status: 'requires_authorization',
        toolKey,
        durationMs: Date.now() - started,
        result: {
          ok: false,
          summary: `Tool "${toolKey}" requires explicit human authorization and was not executed`,
          error: 'requires_authorization',
        },
      });
    }
    if (tool.riskLevel === 'write' && !principal.allowWrite) {
      return finish(denied(toolKey, 'write_not_allowed', `Write tool "${toolKey}" is not allowed for this principal`, started));
    }
    const parsed = tool.input.safeParse(call.input ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      return finish(denied(toolKey, 'invalid_input', `Invalid input for "${toolKey}": ${issues}`, started));
    }

    try {
      const result = await withTimeout(
        (signal) => tool.execute({ ...ctx, signal }, parsed.data),
        tool.timeoutMs ?? this.defaultTimeoutMs,
        ctx.signal,
      );
      return finish({ status: result.ok ? 'ok' : 'error', toolKey, result, durationMs: Date.now() - started });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.warn({ err: error, toolKey }, 'tool execution failed');
      return finish({
        status: 'error',
        toolKey,
        durationMs: Date.now() - started,
        result: { ok: false, summary: `Tool "${toolKey}" failed`, error: message },
      });
    }
  }

  /** Execute several calls concurrently (bounded by the caller), preserving order. */
  async executeAll(ctx: ToolContext, principal: ToolPrincipal, calls: readonly ToolCall[]): Promise<ToolOutcome[]> {
    return Promise.all(calls.map((call) => this.execute(ctx, principal, call)));
  }

  definition(toolKeyOrFunctionName: string): ToolDefinition | undefined {
    return this.registry.get(fromFunctionName(toolKeyOrFunctionName));
  }
}

function denied(
  toolKey: string,
  reason: Extract<ToolOutcome, { status: 'denied' }>['reason'],
  message: string,
  started: number,
): ToolOutcome {
  return {
    status: 'denied',
    toolKey,
    reason,
    durationMs: Date.now() - started,
    result: { ok: false, summary: message, error: reason },
  };
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent.reason);
  if (parent.aborted) controller.abort(parent.reason);
  else parent.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`Tool timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await new Promise<T>((resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(controller.signal.reason instanceof Error ? controller.signal.reason : new Error('Tool aborted')),
        { once: true },
      );
      fn(controller.signal).then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onParentAbort);
  }
}

/** Convert an outcome to the content the model receives as the tool result. */
export function outcomeToModelContent(outcome: ToolOutcome): { content: Record<string, unknown>; isError: boolean } {
  switch (outcome.status) {
    case 'ok':
      return { content: { ok: true, data: outcome.result.data ?? null, summary: outcome.result.summary }, isError: false };
    case 'requires_authorization':
      return {
        content: { ok: false, error: 'requires_authorization', summary: outcome.result.summary },
        isError: true,
      };
    case 'denied':
      return { content: { ok: false, error: outcome.reason, summary: outcome.result.summary }, isError: true };
    case 'error':
    default:
      return { content: { ok: false, error: outcome.result.error ?? 'error', summary: outcome.result.summary }, isError: true };
  }
}
