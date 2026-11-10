import { AGENT_HARD_LIMITS, Permission } from '@hilatech/contracts';
import { z } from 'zod';

import { buildContext, dataBlock, truncateForContext } from '../context/context-builder';
import { AiProviderError, LimitExceededError } from '../errors';
import { buildSystemPrompt } from '../prompts/render';
import type { AiMessage, GenerateRequest, GenerateResult, ToolCall } from '../providers/types';
import { ToolExecutor, outcomeToModelContent, type ToolOutcome } from '../tools/executor';
import { ToolRegistry, toFunctionName } from '../tools/registry';
import type { ToolContext, ToolDefinition, ToolPrincipal } from '../tools/types';
import type {
  AgentDefinition,
  Budget,
  ResolvedModel,
  RunRequest,
  RunResult,
  RunStatus,
  RunnerDeps,
  StepRecord,
} from './types';

const DELEGATE_TOOL = 'agents.delegate';
const DELEGATE_PARALLEL_TOOL = 'agents.delegate_parallel';

interface EffectiveLimits {
  maxSteps: number;
  maxDurationMs: number;
  maxTokens: number;
  maxDelegations: number;
}

/**
 * The agent loop. One instance per process; `run()` is re-entrant (delegation calls it recursively).
 * Every provider call and tool call becomes a persisted step; limits are enforced before each step.
 */
export class AgentRunner {
  constructor(private readonly deps: RunnerDeps) {}

  async run(request: RunRequest): Promise<RunResult> {
    const now = this.deps.now ?? (() => new Date());
    const startedAt = now();
    const limits = effectiveLimits(request.agent, request.caps);
    const budget: Budget = request.budget ?? {
      deadlineAt: startedAt.getTime() + limits.maxDurationMs,
      tokens: { used: 0, max: limits.maxTokens },
      delegations: { used: 0, max: limits.maxDelegations },
    };
    // A child never gets more time than its parent has left.
    budget.deadlineAt = Math.min(budget.deadlineAt, startedAt.getTime() + limits.maxDurationMs);

    const controller = new AbortController();
    const abortOnParent = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) controller.abort(request.signal.reason);
    else request.signal?.addEventListener('abort', abortOnParent, { once: true });
    const deadlineTimer = setTimeout(
      () =>
        controller.abort(
          new LimitExceededError('duration', limits.maxDurationMs, limits.maxDurationMs),
        ),
      Math.max(0, budget.deadlineAt - startedAt.getTime()),
    );

    const steps: StepRecord[] = [];
    const transcript: AiMessage[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let estimatedCost: number | null = 0;
    let costKnown = true;
    const log = this.deps.logger;

    const recordStep = async (step: Omit<StepRecord, 'index'>): Promise<StepRecord> => {
      const full: StepRecord = { ...step, index: steps.length };
      steps.push(full);
      request.onEvent?.({ type: 'step', step: full });
      await this.deps.store.addStep(request.executionId, full);
      return full;
    };

    const finish = async (
      status: RunStatus,
      output: string | null,
      error: string | null,
    ): Promise<RunResult> => {
      clearTimeout(deadlineTimer);
      request.signal?.removeEventListener('abort', abortOnParent);
      const finishedAt = now();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      const result: RunResult = {
        status,
        output,
        error,
        stepCount: steps.length,
        usage: { inputTokens, outputTokens },
        durationMs,
        estimatedCostUsd: costKnown ? estimatedCost : null,
        transcript,
      };
      await this.deps.store.finish(request.executionId, {
        status,
        output,
        error,
        stepCount: steps.length,
        inputTokens,
        outputTokens,
        estimatedCostUsd: result.estimatedCostUsd,
        finishedAt,
        durationMs,
      });
      return result;
    };

    try {
      if (!request.agent.isEnabled) return await finish('failed', null, 'Agent is disabled');
      await this.deps.store.markRunning(request.executionId, startedAt);

      const resolved = await this.deps.resolveModel(request.agent);
      const { registry, principal } = this.buildToolset(request, limits, budget, controller.signal);
      const executor = new ToolExecutor(registry, {
        defaultTimeoutMs: this.deps.toolTimeoutMs,
        onOutcome: async (call, outcome, ctx) => {
          await this.deps.onToolOutcome?.({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            agentId: request.agent.id,
            executionId: request.executionId,
            toolKey: outcome.toolKey,
            outcome,
          });
        },
      });
      const toolCtx: ToolContext = {
        organizationId: request.agent.organizationId,
        userId: request.userId,
        agentId: request.agent.id,
        executionId: request.executionId,
        knowledgeBaseIds: request.agent.knowledgeBaseIds,
        prisma: this.deps.prisma,
        logger: log,
        signal: controller.signal,
        now,
      };

      const system = buildSystemPrompt({
        instructions: request.agent.instructions,
        organizationName: request.organizationName,
        userName: request.userName ?? null,
        now: startedAt.toISOString(),
        locale: request.locale,
        toolNames: principal.allowedTools,
        dataBlocks: request.dataBlocks,
      });

      const history: AiMessage[] = [...(request.history ?? [])];
      const userMessage: AiMessage = {
        role: 'user',
        parts: [
          {
            type: 'text',
            text:
              typeof request.input === 'string'
                ? request.input
                : dataBlock('task-input', JSON.stringify(request.input, null, 2)),
          },
        ],
      };
      history.push(userMessage);
      transcript.push(userMessage);

      const toolSpecs = registry.toSpecs(principal.allowedTools);
      const reserve = request.agent.maxOutputTokens ?? 4096;

      for (let step = 0; ; step += 1) {
        if (controller.signal.aborted) throw controller.signal.reason ?? new Error('aborted');
        if (await this.deps.store.isCancelled(request.executionId))
          return await finish('cancelled', null, 'Cancelled by user');
        if (step >= limits.maxSteps)
          throw new LimitExceededError('steps', step + 1, limits.maxSteps);
        if (budget.tokens.used >= budget.tokens.max)
          throw new LimitExceededError('tokens', budget.tokens.used, budget.tokens.max);

        const window = buildContext({
          system,
          summary: request.summary,
          history,
          budgetTokens: Math.min(
            resolved.contextWindow,
            budget.tokens.max - budget.tokens.used + reserve,
          ),
          reserveForOutputTokens: reserve,
        });
        if (window.messages.length === 0) {
          throw new LimitExceededError('tokens', budget.tokens.used, budget.tokens.max);
        }

        const generateRequest: GenerateRequest = {
          model: resolved.model,
          system: window.system,
          messages: window.messages,
          ...(toolSpecs.length ? { tools: toolSpecs, toolChoice: 'auto' } : {}),
          maxTokens: reserve,
          ...(request.agent.temperature !== null ? { temperature: request.agent.temperature } : {}),
          signal: controller.signal,
          metadata: { executionId: request.executionId },
        };

        const llmStarted = Date.now();
        let result: GenerateResult;
        try {
          result = await this.callModel(resolved, generateRequest, request);
        } catch (error) {
          const durationMs = Date.now() - llmStarted;
          const code = error instanceof AiProviderError ? error.code : 'unknown';
          await this.deps.usage.record({
            organizationId: request.agent.organizationId,
            userId: request.userId,
            agentId: request.agent.id,
            executionId: request.executionId,
            threadId: request.threadId ?? null,
            provider: resolved.providerKind,
            model: resolved.model,
            operation: request.stream ? 'stream' : 'generate',
            status: code === 'timeout' ? 'timeout' : 'error',
            usage: { inputTokens: 0, outputTokens: 0 },
            durationMs,
            errorCode: code,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          await recordStep({
            type: 'error',
            name: 'llm_call',
            input: { model: resolved.model, messages: window.messages.length },
            output: null,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            durationMs,
            inputTokens: null,
            outputTokens: null,
          });
          throw error;
        }
        const llmDuration = Date.now() - llmStarted;
        inputTokens += result.usage.inputTokens;
        outputTokens += result.usage.outputTokens;
        budget.tokens.used += result.usage.inputTokens + result.usage.outputTokens;
        const usageRecord = await this.deps.usage.record({
          organizationId: request.agent.organizationId,
          userId: request.userId,
          agentId: request.agent.id,
          executionId: request.executionId,
          threadId: request.threadId ?? null,
          provider: resolved.providerKind,
          model: resolved.model,
          operation: request.stream ? 'stream' : 'generate',
          status: 'success',
          usage: result.usage,
          durationMs: llmDuration,
          metadata: { finishReason: result.finishReason, step },
        });
        if (usageRecord.estimatedCostUsd === null) costKnown = false;
        else if (costKnown) estimatedCost = (estimatedCost ?? 0) + usageRecord.estimatedCostUsd;

        await recordStep({
          type: 'llm_call',
          name: resolved.model,
          input: {
            messages: window.messages.length,
            truncated: window.truncated,
            tools: toolSpecs.length,
          },
          output: {
            text: truncateForContext(result.text, 4000),
            toolCalls: result.toolCalls.map((c) => ({ name: c.name, input: c.input })),
            finishReason: result.finishReason,
          },
          status: 'succeeded',
          error: null,
          durationMs: llmDuration,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        });

        const assistantMessage: AiMessage = {
          role: 'assistant',
          parts: [
            ...(result.text ? [{ type: 'text' as const, text: result.text }] : []),
            ...result.toolCalls.map((c) => ({
              type: 'tool_call' as const,
              id: c.id,
              name: c.name,
              input: c.input,
            })),
          ],
        };
        if (assistantMessage.parts.length === 0)
          assistantMessage.parts.push({ type: 'text', text: '' });
        history.push(assistantMessage);
        transcript.push(assistantMessage);

        if (result.toolCalls.length === 0) {
          await recordStep({
            type: 'final',
            name: null,
            input: null,
            output: { text: truncateForContext(result.text, 8000) },
            status: 'succeeded',
            error: null,
            durationMs: 0,
            inputTokens: null,
            outputTokens: null,
          });
          return await finish('succeeded', result.text, null);
        }

        if (result.toolCalls.length > AGENT_HARD_LIMITS.maxToolCallsPerStep) {
          throw new LimitExceededError(
            'tool_calls',
            result.toolCalls.length,
            AGENT_HARD_LIMITS.maxToolCallsPerStep,
          );
        }
        const outcomes = await executor.executeAll(toolCtx, principal, result.toolCalls);
        const toolMessage: AiMessage = { role: 'tool', parts: [] };
        for (let i = 0; i < result.toolCalls.length; i += 1) {
          const call = result.toolCalls[i] as ToolCall;
          const outcome = outcomes[i] as ToolOutcome;
          request.onEvent?.({ type: 'tool_result', toolCall: call, outcome });
          const { content, isError } = outcomeToModelContent(outcome);
          const rendered = truncateForContext(JSON.stringify(content));
          toolMessage.parts.push({
            type: 'tool_result',
            toolCallId: call.id,
            name: call.name,
            content: dataBlock(`tool:${outcome.toolKey}`, rendered),
            isError,
          });
          await recordStep({
            type:
              outcome.toolKey === DELEGATE_TOOL || outcome.toolKey === DELEGATE_PARALLEL_TOOL
                ? 'delegation'
                : 'tool_call',
            name: outcome.toolKey,
            input: call.input,
            output: outcome.result.data ?? { summary: outcome.result.summary },
            status:
              outcome.status === 'ok'
                ? 'succeeded'
                : outcome.status === 'denied'
                  ? 'denied'
                  : outcome.status === 'requires_authorization'
                    ? 'requires_authorization'
                    : 'failed',
            error:
              outcome.status === 'ok' ? null : (outcome.result.error ?? outcome.result.summary),
            durationMs: outcome.durationMs,
            inputTokens: null,
            outputTokens: null,
          });
        }
        history.push(toolMessage);
        transcript.push(toolMessage);
      }
    } catch (error) {
      if (error instanceof LimitExceededError) {
        const status: RunStatus = error.limit === 'duration' ? 'timed_out' : 'failed';
        log.warn(
          { executionId: request.executionId, limit: error.limit },
          'agent execution hit a limit',
        );
        return finish(status, null, error.message);
      }
      if (controller.signal.aborted && !(error instanceof AiProviderError)) {
        const reason = controller.signal.reason;
        if (reason instanceof LimitExceededError) return finish('timed_out', null, reason.message);
        return finish('cancelled', null, reason instanceof Error ? reason.message : 'Cancelled');
      }
      // The deadline timer may fire a millisecond before Date.now() reaches deadlineAt, so decide by the abort
      // reason (set by that timer) as well as by the clock.
      const abortedByDeadline =
        controller.signal.aborted &&
        controller.signal.reason instanceof LimitExceededError &&
        controller.signal.reason.limit === 'duration';
      if (
        error instanceof AiProviderError &&
        error.code === 'timeout' &&
        (abortedByDeadline || Date.now() >= budget.deadlineAt)
      ) {
        return finish('timed_out', null, `Execution exceeded ${limits.maxDurationMs}ms`);
      }
      log.error({ err: error, executionId: request.executionId }, 'agent execution failed');
      return finish('failed', null, error instanceof Error ? error.message : String(error));
    }
  }

  /** Provider call with retry on retryable errors, honouring the retry policy and the deadline. */
  private async callModel(
    resolved: ResolvedModel,
    generateRequest: GenerateRequest,
    request: RunRequest,
  ): Promise<GenerateResult> {
    const policy = request.agent.retryPolicy;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        if (request.stream) {
          let final: GenerateResult | null = null;
          for await (const event of resolved.provider.stream(generateRequest)) {
            if (event.type === 'text_delta')
              request.onEvent?.({ type: 'text_delta', delta: event.delta });
            else if (event.type === 'tool_call')
              request.onEvent?.({ type: 'tool_call', toolCall: event.toolCall });
            else final = event.result;
          }
          if (!final)
            throw new AiProviderError({
              provider: resolved.providerKind,
              code: 'unknown',
              message: 'Stream ended without a result',
              retryable: false,
            });
          return final;
        }
        return await resolved.provider.generate(generateRequest);
      } catch (error) {
        const retryable =
          error instanceof AiProviderError && error.retryable && !generateRequest.signal?.aborted;
        if (!retryable || attempt >= policy.maxAttempts) throw error;
        const delay = policy.backoffMs * 2 ** (attempt - 1);
        this.deps.logger.warn(
          { attempt, delay, code: (error as AiProviderError).code },
          'retrying provider call',
        );
        await sleep(delay, generateRequest.signal);
      }
    }
  }

  /** Per-run registry = shared tools + delegation tools bound to this run; plus the effective principal. */
  private buildToolset(
    request: RunRequest,
    limits: EffectiveLimits,
    budget: Budget,
    signal: AbortSignal,
  ): { registry: ToolRegistry; principal: ToolPrincipal } {
    const registry = new ToolRegistry();
    registry.registerAll(this.deps.registry.list());
    const allowed = new Set(request.agent.tools.filter((k) => this.deps.registry.has(k)));

    const canDelegate =
      request.agent.permissions.allowDelegation &&
      request.depth < AGENT_HARD_LIMITS.maxDelegationDepth &&
      limits.maxDelegations > 0;
    if (canDelegate) {
      for (const tool of this.delegationTools(request, budget, signal)) {
        registry.register(tool);
        allowed.add(tool.key);
      }
    }

    // Effective permissions: the user's (if any) — an agent never exceeds the human it acts for.
    // Without a human, the admin-configured tool list itself is the grant.
    const toolPermissions = [...allowed]
      .map((k) => registry.get(k)?.requiredPermission)
      .filter((p): p is Permission => Boolean(p));
    if (canDelegate) toolPermissions.push(Permission.AGENTS_EXECUTE);
    const permissions = request.userPermissions
      ? request.userPermissions.filter((p) => toolPermissions.includes(p as Permission))
      : toolPermissions;

    return {
      registry,
      principal: {
        allowedTools: [...allowed],
        permissions,
        allowWrite: request.agent.permissions.allowWrite,
      },
    };
  }

  private delegationTools(
    request: RunRequest,
    budget: Budget,
    signal: AbortSignal,
  ): ToolDefinition[] {
    const delegateOnce = async (
      ctx: ToolContext,
      agentId: string,
      task: string,
      context: Record<string, unknown> | undefined,
    ) => {
      if (agentId === request.agent.id || request.ancestry.includes(agentId)) {
        return {
          ok: false,
          summary: 'Delegation cycle detected (agent is already in the execution chain)',
          error: 'delegation_cycle',
        };
      }
      const allowedTargets = request.agent.permissions.delegateTo;
      if (allowedTargets.length > 0 && !allowedTargets.includes(agentId)) {
        return {
          ok: false,
          summary: `Delegation to agent ${agentId} is not allowed`,
          error: 'delegation_not_allowed',
        };
      }
      if (budget.delegations.used >= budget.delegations.max) {
        return {
          ok: false,
          summary: `Delegation limit reached (${budget.delegations.max})`,
          error: 'delegation_limit',
        };
      }
      const target = await this.deps.loadAgent(request.agent.organizationId, agentId);
      if (!target || !target.isEnabled)
        return { ok: false, summary: 'Target agent not found or disabled', error: 'not_found' };
      budget.delegations.used += 1;
      const child = await this.deps.store.createChild({
        organizationId: request.agent.organizationId,
        agentId: target.id,
        parentExecutionId: request.executionId,
        rootExecutionId: request.rootExecutionId,
        depth: request.depth + 1,
        input: { task, context: context ?? null },
        triggeredByUserId: request.userId,
      });
      // Least privilege: a delegate never writes unless the delegating agent may write too (a read-only agent
      // must not be able to launder a write through a more privileged colleague after a prompt injection).
      const childAgent: AgentDefinition = {
        ...target,
        permissions: {
          ...target.permissions,
          allowWrite: target.permissions.allowWrite && request.agent.permissions.allowWrite,
        },
      };
      const childResult = await this.run({
        executionId: child.id,
        agent: childAgent,
        input: context
          ? `${task}\n\n${dataBlock('delegation-context', JSON.stringify(context, null, 2))}`
          : task,
        userId: request.userId,
        userPermissions: request.userPermissions,
        trigger: 'agent',
        depth: request.depth + 1,
        rootExecutionId: request.rootExecutionId,
        ancestry: [...request.ancestry, request.agent.id],
        budget,
        signal,
        organizationName: request.organizationName,
        locale: request.locale,
      });
      request.onEvent?.({
        type: 'delegation',
        executionId: child.id,
        agentId: target.id,
        status: childResult.status,
      });
      return {
        ok: childResult.status === 'succeeded',
        summary: `Agent "${target.name}" ${childResult.status}`,
        data: {
          executionId: child.id,
          agent: target.name,
          status: childResult.status,
          output: childResult.output,
          error: childResult.error,
        },
        error: childResult.error ?? undefined,
      };
    };

    const delegate: ToolDefinition = {
      key: DELEGATE_TOOL,
      name: 'Delegate to agent',
      description:
        'Hand a well-defined sub-task to another agent of the organization and wait for its result.',
      category: 'agents',
      riskLevel: 'read',
      requiredPermission: Permission.AGENTS_EXECUTE,
      input: z.object({
        agentId: z.string().uuid(),
        task: z.string().trim().min(1).max(20_000),
        context: z.record(z.string(), z.unknown()).optional(),
      }),
      timeoutMs: Math.max(1000, budget.deadlineAt - Date.now()),
      execute: (ctx, input) => delegateOnce(ctx, input.agentId, input.task, input.context),
    };
    const delegateParallel: ToolDefinition = {
      key: DELEGATE_PARALLEL_TOOL,
      name: 'Delegate in parallel',
      description:
        'Run several independent sub-tasks on other agents at the same time and aggregate their results.',
      category: 'agents',
      riskLevel: 'read',
      requiredPermission: Permission.AGENTS_EXECUTE,
      input: z.object({
        tasks: z
          .array(
            z.object({
              agentId: z.string().uuid(),
              task: z.string().trim().min(1).max(20_000),
              context: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .min(1)
          .max(5),
      }),
      timeoutMs: Math.max(1000, budget.deadlineAt - Date.now()),
      async execute(ctx, input) {
        const settled = await Promise.allSettled(
          (
            input.tasks as Array<{
              agentId: string;
              task: string;
              context?: Record<string, unknown>;
            }>
          ).map((t) => delegateOnce(ctx, t.agentId, t.task, t.context)),
        );
        const results = settled.map((s, i) =>
          s.status === 'fulfilled'
            ? s.value
            : {
                ok: false,
                summary: `Delegation ${i} crashed`,
                error: s.reason instanceof Error ? s.reason.message : String(s.reason),
              },
        );
        const okCount = results.filter((r) => r.ok).length;
        return {
          ok: okCount > 0,
          summary: `${okCount}/${results.length} delegated task(s) succeeded`,
          data: results.map((r) => r.data ?? { error: r.error, summary: r.summary }),
        };
      },
    };
    return [delegate, delegateParallel];
  }
}

export function effectiveLimits(
  agent: AgentDefinition,
  caps?: RunRequest['caps'],
): EffectiveLimits {
  return {
    maxSteps: Math.min(agent.maxSteps, caps?.maxSteps ?? Infinity, AGENT_HARD_LIMITS.maxSteps),
    maxDurationMs: Math.min(
      agent.maxDurationMs,
      caps?.maxDurationMs ?? Infinity,
      AGENT_HARD_LIMITS.maxDurationMs,
    ),
    maxTokens: Math.min(agent.maxTokens, caps?.maxTokens ?? Infinity, AGENT_HARD_LIMITS.maxTokens),
    maxDelegations: Math.min(agent.maxDelegations, AGENT_HARD_LIMITS.maxDelegationsPerExecution),
  };
}

/** Function name the model uses for a tool key (exported for tests/UI). */
export const toolFunctionName = toFunctionName;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      },
      { once: true },
    );
  });
}
