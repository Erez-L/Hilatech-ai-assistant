import type { WorkflowStep, WorkflowStepResult } from '@hilatech/contracts';
import { deterministicUuid } from './deterministic-id';
import {
  StepError,
  WorkflowRunner,
  capOutput,
  type RunnerInput,
  type StepHandlers,
} from './workflow-runner';

const noop = async () => undefined;

function make(
  steps: WorkflowStep[],
  handlers: StepHandlers,
  overrides: Partial<RunnerInput> = {},
): { input: RunnerInput; persisted: WorkflowStepResult[][]; resumes: Array<[number, number]> } {
  const persisted: WorkflowStepResult[][] = [];
  const resumes: Array<[number, number]> = [];
  let clock = 1_000;
  return {
    persisted,
    resumes,
    input: {
      steps,
      previous: [],
      trigger: { type: 'event', payload: { leadId: 'L1', status: 'won', value: 50 } },
      input: { leadId: 'L1', status: 'won', value: 50 },
      organization: { id: 'org1', name: 'Acme', timezone: 'UTC' },
      handlers,
      persist: async (r) => {
        persisted.push(r);
      },
      scheduleResume: async (s, i) => {
        resumes.push([s, i]);
      },
      now: () => (clock += 10),
      sleep: noop,
      ...overrides,
    },
  };
}

const note = (id: string, body = 'x'): WorkflowStep => ({ id, type: 'create_lead_note', leadId: 'L1', body });

describe('WorkflowRunner', () => {
  it('runs steps in order, passes outputs to later templates and persists after every step', async () => {
    const seen: string[] = [];
    const steps: WorkflowStep[] = [
      { id: 'a', type: 'http_request', method: 'GET', url: 'https://x.test', headers: {}, timeoutMs: 1000 },
      note('b', 'status was {{ steps.a.output.status }} for {{ trigger.payload.leadId }}'),
    ];
    const { input, persisted } = make(steps, {
      http_request: async () => ({ status: 201 }),
      create_lead_note: async (step, rt) => {
        if (step.type !== 'create_lead_note') throw new Error('type');
        seen.push(rt.render(step.body));
        return { noteId: 'n1' };
      },
    });
    const out = await new WorkflowRunner().run(input);
    expect(out.status).toBe('succeeded');
    expect(seen).toEqual(['status was 201 for L1']);
    expect(out.results.map((r) => [r.stepId, r.status])).toEqual([
      ['a', 'succeeded'],
      ['b', 'succeeded'],
    ]);
    expect(persisted).toHaveLength(2); // once per step
    expect(persisted[0]).toHaveLength(1);
    expect(persisted[1]).toHaveLength(2);
  });

  it('condition runs the taken branch and skips the other', async () => {
    const ran: string[] = [];
    const handler = async (step: WorkflowStep) => {
      ran.push(step.id);
      return {};
    };
    const steps: WorkflowStep[] = [
      { id: 'c', type: 'condition', left: '{{ trigger.payload.status }}', operator: 'eq', right: 'won', then: ['yes'], else: ['no'] },
      note('yes'),
      note('no'),
      note('always'),
    ];
    const { input } = make(steps, { create_lead_note: handler });
    const out = await new WorkflowRunner().run(input);
    expect(out.status).toBe('succeeded');
    expect(ran).toEqual(['yes', 'always']);
    expect(out.results.find((r) => r.stepId === 'no')?.status).toBe('skipped');
    expect((out.results[0]!.output as { result: boolean }).result).toBe(true);
  });

  it('condition false takes the else branch; gt compares numbers', async () => {
    const ran: string[] = [];
    const steps: WorkflowStep[] = [
      { id: 'c', type: 'condition', left: '{{ trigger.payload.value }}', operator: 'gt', right: '100', then: ['big'], else: ['small'] },
      note('big'),
      note('small'),
    ];
    const { input } = make(steps, { create_lead_note: async (s) => (ran.push(s.id), {}) });
    await new WorkflowRunner().run(input);
    expect(ran).toEqual(['small']);
  });

  it('set_variable stores typed values readable as vars.*', async () => {
    const seen: string[] = [];
    const steps: WorkflowStep[] = [
      { id: 'v', type: 'set_variable', name: 'who', value: '{{ organization.name }}-{{ trigger.payload.leadId }}' },
      note('n', '{{ vars.who }}'),
    ];
    const { input } = make(steps, {
      create_lead_note: async (s, rt) => (seen.push(rt.render((s as Extract<WorkflowStep, { type: 'create_lead_note' }>).body)), {}),
    });
    const out = await new WorkflowRunner().run(input);
    expect(seen).toEqual(['Acme-L1']);
    expect(out.status === 'succeeded' && out.vars).toEqual({ who: 'Acme-L1' });
  });

  it('delay persists progress, schedules a resume and returns waiting; resume continues at the next step', async () => {
    const steps: WorkflowStep[] = [note('first'), { id: 'wait', type: 'delay', seconds: 90 }, note('last')];
    const ran: string[] = [];
    const handlers: StepHandlers = { create_lead_note: async (s) => (ran.push(s.id), { ok: true }) };
    const first = make(steps, handlers);
    const waiting = await new WorkflowRunner().run(first.input);
    expect(waiting.status).toBe('waiting');
    expect(first.resumes).toEqual([[90, 2]]);
    expect(ran).toEqual(['first']);
    expect(waiting.results).toHaveLength(2);

    const second = make(steps, handlers, { previous: waiting.results });
    const done = await new WorkflowRunner().run(second.input);
    expect(done.status).toBe('succeeded');
    expect(ran).toEqual(['first', 'last']);
    expect(done.results.map((r) => r.stepId)).toEqual(['first', 'wait', 'last']);
  });

  it('resuming rebuilds variables and skipped branches from persisted results', async () => {
    const steps: WorkflowStep[] = [
      { id: 'v', type: 'set_variable', name: 'k', value: 'kept' },
      { id: 'c', type: 'condition', left: 'a', operator: 'eq', right: 'a', then: [], else: ['skipme'] },
      { id: 'd', type: 'delay', seconds: 1 },
      note('skipme'),
      note('use', '{{ vars.k }}'),
    ];
    const ran: string[] = [];
    const seen: string[] = [];
    const handlers: StepHandlers = {
      create_lead_note: async (s, rt) => {
        ran.push(s.id);
        seen.push(rt.render((s as Extract<WorkflowStep, { type: 'create_lead_note' }>).body));
        return {};
      },
    };
    const a = await new WorkflowRunner().run(make(steps, handlers).input);
    expect(a.status).toBe('waiting');
    const b = await new WorkflowRunner().run(make(steps, handlers, { previous: a.results }).input);
    expect(b.status).toBe('succeeded');
    expect(ran).toEqual(['use']);
    expect(seen).toEqual(['kept']);
  });

  it('a failing step stops the run and reports the step id (later steps do not run)', async () => {
    const ran: string[] = [];
    const steps: WorkflowStep[] = [note('a'), note('b'), note('c')];
    const { input } = make(steps, {
      create_lead_note: async (s) => {
        ran.push(s.id);
        if (s.id === 'b') throw new StepError('boom', { output: { why: 'test' } });
        return {};
      },
    });
    const out = await new WorkflowRunner().run(input);
    expect(out.status).toBe('failed');
    if (out.status !== 'failed') return;
    expect(out.stepId).toBe('b');
    expect(out.error).toContain('Step "b" failed: boom');
    expect(ran).toEqual(['a', 'b']);
    expect(out.results[1]).toMatchObject({ status: 'failed', error: 'boom', output: { why: 'test' } });
  });

  it('retries retryable errors with backoff, then succeeds', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const { input } = make(
      [{ id: 'h', type: 'http_request', method: 'GET', url: 'https://x.test', headers: {}, timeoutMs: 1000 }],
      {
        http_request: async () => {
          calls += 1;
          if (calls < 3) throw new StepError('HTTP 503', { retryable: true });
          return { status: 200 };
        },
      },
      { sleep: async (ms) => void sleeps.push(ms), retryBackoffMs: [5, 10] },
    );
    const out = await new WorkflowRunner().run(input);
    expect(out.status).toBe('succeeded');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([5, 10]);
  });

  it('gives up after the retry budget and does not retry non-retryable errors', async () => {
    let calls = 0;
    const retry = make(
      [{ id: 'h', type: 'http_request', method: 'GET', url: 'https://x.test', headers: {}, timeoutMs: 1000 }],
      { http_request: async () => (calls++, Promise.reject(new StepError('down', { retryable: true }))) },
      { retryBackoffMs: [1, 1] },
    );
    expect((await new WorkflowRunner().run(retry.input)).status).toBe('failed');
    expect(calls).toBe(3);

    calls = 0;
    const hard = make(
      [{ id: 'h', type: 'http_request', method: 'GET', url: 'https://x.test', headers: {}, timeoutMs: 1000 }],
      { http_request: async () => (calls++, Promise.reject(new StepError('HTTP 404'))) },
    );
    expect((await new WorkflowRunner().run(hard.input)).status).toBe('failed');
    expect(calls).toBe(1);
  });

  it('unexpected (non-StepError) exceptions fail the step without retry', async () => {
    let calls = 0;
    const { input } = make([note('a')], { create_lead_note: async () => (calls++, Promise.reject(new TypeError('bad'))) });
    const out = await new WorkflowRunner().run(input);
    expect(out.status).toBe('failed');
    expect(calls).toBe(1);
  });

  it('fails a step type without a handler', async () => {
    const { input } = make([note('a')], {});
    const out = await new WorkflowRunner().run(input);
    expect(out.status).toBe('failed');
  });

  it('stops when the active-time budget is exhausted', async () => {
    const steps: WorkflowStep[] = [note('a'), note('b')];
    let t = 0;
    const { input } = make(
      steps,
      { create_lead_note: async () => ({}) },
      { budgetMs: 100, now: () => (t += 150) },
    );
    const out = await new WorkflowRunner().run(input);
    expect(out.status).toBe('failed');
    if (out.status === 'failed') expect(out.error).toContain('limit');
  });

  it('aborts cooperatively (e.g. workflow disabled mid-run)', async () => {
    let checks = 0;
    const { input } = make([note('a'), note('b')], { create_lead_note: async () => ({}) }, {
      shouldAbort: async () => ++checks > 1,
    });
    const out = await new WorkflowRunner().run(input);
    expect(out.status).toBe('aborted');
    expect(out.results).toHaveLength(1);
  });

  it('templates cannot reach prototypes or other tenants through the context', async () => {
    const seen: string[] = [];
    const { input } = make([note('a', '[{{ trigger.constructor }}][{{ __proto__ }}][{{ organization.id }}]')], {
      create_lead_note: async (s, rt) => (seen.push(rt.render((s as Extract<WorkflowStep, { type: 'create_lead_note' }>).body)), {}),
    });
    await new WorkflowRunner().run(input);
    expect(seen).toEqual(['[][][org1]']);
  });
});

describe('capOutput', () => {
  it('passes small values through (JSON-normalised) and truncates huge ones', () => {
    expect(capOutput({ a: 1, u: undefined })).toEqual({ a: 1 });
    expect(capOutput(undefined)).toBeNull();
    const big = capOutput({ text: 'x'.repeat(50_000) }) as { truncated: boolean; preview: string };
    expect(big.truncated).toBe(true);
    expect(big.preview.length).toBeLessThanOrEqual(2_000);
  });
});

describe('deterministicUuid', () => {
  it('is stable, uuid-shaped and input-sensitive', () => {
    const a = deterministicUuid('x', 'y');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicUuid('x', 'y')).toBe(a);
    expect(deterministicUuid('x', 'z')).not.toBe(a);
    expect(deterministicUuid('xy', '')).not.toBe(deterministicUuid('x', 'y'));
  });
});
