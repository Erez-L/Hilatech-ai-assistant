import {
  type WorkflowStep,
  type WorkflowStepResult,
  WORKFLOW_LIMITS,
  evaluateCondition,
  renderTemplate,
  renderTemplateValue,
} from '@hilatech/contracts';

/** Thrown by step handlers. `retryable` errors (network, 5xx, 429) are retried by the runner. */
export class StepError extends Error {
  constructor(
    message: string,
    readonly options: { retryable?: boolean; output?: unknown } = {},
  ) {
    super(message);
    this.name = 'StepError';
  }
  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}

export interface TemplateContext extends Record<string, unknown> {
  trigger: Record<string, unknown>;
  input: unknown;
  steps: Record<string, { status: WorkflowStepResult['status']; output: unknown }>;
  vars: Record<string, unknown>;
  organization: Record<string, unknown>;
}

export interface StepRuntime {
  /** Index of the step in the workflow. */
  index: number;
  /** Renders `{{ }}` templates against the live context. */
  render(template: string): string;
  /** Raw (typed) render; a template that is exactly one expression returns the value itself. */
  renderValue(template: string): unknown;
  context: TemplateContext;
  /** Milliseconds left of the execution's active-time budget. */
  remainingMs: number;
}

/** Returns the step output (stored under `steps.<id>.output`). Throw `StepError` to fail the step. */
export type StepHandler<S extends WorkflowStep = WorkflowStep> = (
  step: S,
  runtime: StepRuntime,
) => Promise<unknown>;

export type StepHandlers = {
  [K in WorkflowStep['type']]?: StepHandler<Extract<WorkflowStep, { type: K }>>;
};

export interface RunnerInput {
  steps: readonly WorkflowStep[];
  /** Results of already finished steps; `previous.length` is the index to continue from. */
  previous: readonly WorkflowStepResult[];
  trigger: Record<string, unknown>;
  input: unknown;
  organization: Record<string, unknown>;
  handlers: StepHandlers;
  /** Persist the full results array (called after every step). */
  persist(results: WorkflowStepResult[]): Promise<void>;
  /** Re-enqueue the execution after a `delay` step. */
  scheduleResume(delaySeconds: number, nextIndex: number): Promise<void>;
  /** Cooperative stop (e.g. workflow disabled or execution cancelled meanwhile). */
  shouldAbort?(): Promise<boolean>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Active time budget for the whole execution (default 15 min). */
  budgetMs?: number;
  /** Retry delays for `retryable` step errors. */
  retryBackoffMs?: readonly number[];
}

export type RunnerOutcome =
  | { status: 'succeeded'; results: WorkflowStepResult[]; vars: Record<string, unknown> }
  | { status: 'waiting'; results: WorkflowStepResult[]; resumeAt: string }
  | { status: 'failed'; results: WorkflowStepResult[]; error: string; stepId: string | null }
  | { status: 'aborted'; results: WorkflowStepResult[] };

const MAX_OUTPUT_CHARS = 20_000;
const DEFAULT_BACKOFF = [1_000, 3_000] as const;

/** Keeps persisted step outputs bounded; oversize values are replaced by a marked preview. */
export function capOutput(value: unknown): unknown {
  if (value === undefined) return null;
  let text: string;
  try {
    text = JSON.stringify(value) ?? 'null';
  } catch {
    return { truncated: true, preview: String(value).slice(0, 500) };
  }
  if (text.length <= MAX_OUTPUT_CHARS) return JSON.parse(text) as unknown;
  return { truncated: true, preview: text.slice(0, 2_000) };
}

function rebuildContext(
  steps: readonly WorkflowStep[],
  previous: readonly WorkflowStepResult[],
  input: RunnerInput,
): { context: TemplateContext; skip: Set<string> } {
  const context: TemplateContext = {
    trigger: input.trigger,
    input: input.input,
    steps: {},
    vars: {},
    organization: input.organization,
  };
  const skip = new Set<string>();
  for (const result of previous) {
    context.steps[result.stepId] = { status: result.status, output: result.output };
    if (result.status !== 'succeeded' || !result.output || typeof result.output !== 'object') continue;
    const out = result.output as Record<string, unknown>;
    if (result.type === 'set_variable' && typeof out.name === 'string') context.vars[out.name] = out.value;
    if (result.type === 'condition' && Array.isArray(out.skip)) {
      for (const id of out.skip) if (typeof id === 'string') skip.add(id);
    }
  }
  void steps;
  return { context, skip };
}

/**
 * Executes workflow steps sequentially. Pure orchestration: all side effects go through the injected
 * handlers and ports, so the runner is fully unit-testable.
 *
 * - `condition` evaluates the rendered operands and marks the steps of the NOT-taken branch as skipped;
 * - `set_variable` stores a value readable as `{{ vars.name }}`;
 * - `delay` persists progress, asks the caller to re-enqueue a resume job and returns `waiting`;
 * - retryable handler failures are retried with backoff; any other failure stops the execution (`failed`);
 * - every step result is persisted right after the step finishes, so a crash resumes at the next step.
 */
export class WorkflowRunner {
  async run(input: RunnerInput): Promise<RunnerOutcome> {
    const now = input.now ?? Date.now;
    const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const budget = input.budgetMs ?? WORKFLOW_LIMITS.maxExecutionMs;
    const backoff = input.retryBackoffMs ?? DEFAULT_BACKOFF;
    const results: WorkflowStepResult[] = [...input.previous];
    const { context, skip } = rebuildContext(input.steps, results, input);
    let usedMs = results.reduce((sum, r) => sum + r.durationMs, 0);

    for (let index = results.length; index < input.steps.length; index += 1) {
      const step = input.steps[index]!;
      if (input.shouldAbort && (await input.shouldAbort())) return { status: 'aborted', results };

      if (usedMs > budget) {
        return {
          status: 'failed',
          results,
          stepId: step.id,
          error: `Execution exceeded the ${Math.round(budget / 60_000)} minute limit`,
        };
      }

      const runtime: StepRuntime = {
        index,
        context,
        remainingMs: Math.max(0, budget - usedMs),
        render: (t) => renderTemplate(t, context),
        renderValue: (t) => renderTemplateValue(t, context),
      };
      const startedAt = now();
      const finish = async (
        status: WorkflowStepResult['status'],
        output: unknown,
        error: string | null,
      ): Promise<WorkflowStepResult> => {
        const durationMs = Math.max(0, now() - startedAt);
        usedMs += durationMs;
        const result: WorkflowStepResult = {
          stepId: step.id,
          type: step.type,
          status,
          output: capOutput(output),
          error,
          durationMs,
        };
        results.push(result);
        context.steps[step.id] = { status, output: result.output };
        await input.persist([...results]);
        return result;
      };

      if (skip.has(step.id)) {
        await finish('skipped', null, null);
        continue;
      }

      switch (step.type) {
        case 'condition': {
          const left = runtime.render(step.left);
          const right = step.right === undefined ? '' : runtime.render(step.right);
          const result = evaluateCondition(left, step.operator, right);
          const skipped = result ? step.else : step.then;
          for (const id of skipped) skip.add(id);
          await finish('succeeded', { result, left, right, operator: step.operator, skip: skipped }, null);
          continue;
        }
        case 'set_variable': {
          const value = runtime.renderValue(step.value);
          context.vars[step.name] = value;
          await finish('succeeded', { name: step.name, value }, null);
          continue;
        }
        case 'delay': {
          const resumeAt = new Date(now() + step.seconds * 1000).toISOString();
          await finish('succeeded', { seconds: step.seconds, resumeAt }, null);
          await input.scheduleResume(step.seconds, results.length);
          return { status: 'waiting', results, resumeAt };
        }
        default:
          break;
      }

      const handler = input.handlers[step.type] as StepHandler | undefined;
      if (!handler) {
        await finish('failed', null, `No handler for step type "${step.type}"`);
        return { status: 'failed', results, stepId: step.id, error: `No handler for step type "${step.type}"` };
      }

      let attempt = 0;
      for (;;) {
        try {
          const output = await handler(step, runtime);
          await finish('succeeded', output, null);
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const retryable = error instanceof StepError && error.retryable;
          if (retryable && attempt < backoff.length && usedMs + (backoff[attempt] ?? 0) < budget) {
            await sleep(backoff[attempt]!);
            attempt += 1;
            continue;
          }
          const output = error instanceof StepError ? error.options.output : undefined;
          await finish('failed', output, message.slice(0, 1_000));
          return {
            status: 'failed',
            results,
            stepId: step.id,
            error: `Step "${step.id}" failed: ${message}`.slice(0, 1_000),
          };
        }
      }
    }
    return { status: 'succeeded', results, vars: context.vars };
  }
}
