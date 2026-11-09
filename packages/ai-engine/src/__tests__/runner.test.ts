import type { PrismaClient } from '@hilatech/database';
import { describe, expect, it } from 'vitest';

import { AiProviderError } from '../errors';
import { AgentRunner } from '../orchestrator/runner';
import type { AgentDefinition, ExecutionStore, RunnerDeps, StepRecord, UsageEntry, UsageRecorder } from '../orchestrator/types';
import { MockProvider, type MockTurn } from '../providers/mock';
import { timeNowTool } from '../tools/builtin/utility';
import { ToolRegistry } from '../tools/registry';
import { noopLogger } from '../tools/types';
import { PricingTable } from '../usage/pricing';

class MemoryStore implements ExecutionStore {
  steps = new Map<string, StepRecord[]>();
  finished = new Map<string, Parameters<ExecutionStore['finish']>[1]>();
  children: Array<Parameters<ExecutionStore['createChild']>[0] & { id: string }> = [];
  cancelled = new Set<string>();
  private counter = 0;
  async markRunning(): Promise<void> {}
  async addStep(executionId: string, step: StepRecord): Promise<void> {
    this.steps.set(executionId, [...(this.steps.get(executionId) ?? []), step]);
  }
  async finish(executionId: string, result: Parameters<ExecutionStore['finish']>[1]): Promise<void> {
    this.finished.set(executionId, result);
  }
  async createChild(params: Parameters<ExecutionStore['createChild']>[0]): Promise<{ id: string }> {
    const id = `child-${++this.counter}`;
    this.children.push({ ...params, id });
    return { id };
  }
  async isCancelled(executionId: string): Promise<boolean> {
    return this.cancelled.has(executionId);
  }
}

class MemoryUsage implements UsageRecorder {
  entries: UsageEntry[] = [];
  constructor(private readonly pricing = new PricingTable()) {}
  async record(entry: UsageEntry): Promise<{ estimatedCostUsd: number | null }> {
    this.entries.push(entry);
    return { estimatedCostUsd: this.pricing.estimate(entry.provider, entry.model, entry.usage) };
  }
}

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
    organizationId: 'org-1',
    name: 'Tester',
    instructions: 'You test things.',
    providerConfigId: null,
    model: 'mock-chat',
    temperature: null,
    maxOutputTokens: 256,
    tools: ['time.now'],
    permissions: { allowWrite: false, allowDelegation: false, delegateTo: [] },
    knowledgeBaseIds: [],
    maxSteps: 6,
    maxDurationMs: 5_000,
    maxTokens: 50_000,
    maxDelegations: 3,
    retryPolicy: { maxAttempts: 2, backoffMs: 1 },
    isEnabled: true,
    ...overrides,
  };
}

function setup(script: MockTurn[], options: { agents?: AgentDefinition[]; latencyMs?: number; pricing?: PricingTable; sharedProvider?: MockProvider } = {}) {
  const provider = options.sharedProvider ?? new MockProvider({ script, latencyMs: options.latencyMs });
  const store = new MemoryStore();
  const usage = new MemoryUsage(options.pricing);
  const deps: RunnerDeps = {
    prisma: {} as PrismaClient,
    logger: noopLogger,
    registry: new ToolRegistry().register(timeNowTool),
    store,
    usage,
    resolveModel: async (a) => ({ provider, providerKind: 'mock', providerConfigId: null, model: a.model ?? 'mock-chat', contextWindow: 32_000 }),
    loadAgent: async (_org, id) => options.agents?.find((a) => a.id === id) ?? null,
    now: () => new Date(),
  };
  return { runner: new AgentRunner(deps), store, usage, provider };
}

const base = { executionId: 'exec-1', userId: 'user-1', userPermissions: ['leads:read'], trigger: 'manual' as const, depth: 0, rootExecutionId: 'exec-1', ancestry: [] };

describe('AgentRunner', () => {
  it('answers directly and records llm_call + final steps and usage', async () => {
    const { runner, store, usage } = setup([{ text: 'The answer is 42.' }]);
    const result = await runner.run({ ...base, agent: agent(), input: 'What is the answer?' });
    expect(result.status).toBe('succeeded');
    expect(result.output).toBe('The answer is 42.');
    expect(store.steps.get('exec-1')?.map((s) => s.type)).toEqual(['llm_call', 'final']);
    expect(usage.entries).toHaveLength(1);
    expect(usage.entries[0]?.status).toBe('success');
    expect(result.estimatedCostUsd).toBeNull(); // no pricing configured → never invented
    expect(store.finished.get('exec-1')?.status).toBe('succeeded');
  });

  it('runs the tool loop: tool call → tool result → final answer', async () => {
    const { runner, store, provider } = setup([{ toolCalls: [{ name: 'time__now', input: {} }] }, { text: 'It is now.' }]);
    const events: string[] = [];
    const result = await runner.run({ ...base, agent: agent(), input: 'What time is it?', onEvent: (e) => events.push(e.type) });
    expect(result.status).toBe('succeeded');
    expect(store.steps.get('exec-1')?.map((s) => s.type)).toEqual(['llm_call', 'tool_call', 'llm_call', 'final']);
    expect(events).toContain('tool_result');
    // The second request carried the tool result as data, not as instructions.
    const second = provider.requests[1];
    const toolMsg = second?.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(JSON.stringify(toolMsg)).toContain('<data source="tool:time.now">');
    expect(result.transcript.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });

  it('reports denied tools back to the model instead of crashing', async () => {
    const { runner, store } = setup([{ toolCalls: [{ name: 'crm__create_lead', input: { title: 'x' } }] }, { text: 'I cannot do that.' }]);
    const result = await runner.run({ ...base, agent: agent({ tools: ['time.now'] }), input: 'create a lead' });
    expect(result.status).toBe('succeeded');
    const toolStep = store.steps.get('exec-1')?.find((s) => s.type === 'tool_call');
    expect(toolStep?.status).toBe('denied');
  });

  it('stops at the step limit', async () => {
    const loop: MockTurn[] = Array.from({ length: 10 }, () => ({ toolCalls: [{ name: 'time__now', input: {} }] }));
    const { runner } = setup(loop);
    const result = await runner.run({ ...base, agent: agent({ maxSteps: 3 }), input: 'loop forever' });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/steps/);
    expect(result.stepCount).toBeGreaterThan(0);
  });

  it('times out when the duration limit is hit', async () => {
    const { runner } = setup([{ text: 'late' }], { latencyMs: 300 });
    const result = await runner.run({ ...base, agent: agent({ maxDurationMs: 50 }), input: 'slow' });
    expect(result.status).toBe('timed_out');
  });

  it('honours cooperative cancellation between steps', async () => {
    const { runner, store } = setup([{ toolCalls: [{ name: 'time__now', input: {} }] }, { text: 'never' }]);
    const original = store.isCancelled.bind(store);
    let calls = 0;
    store.isCancelled = async (id) => {
      calls += 1;
      return calls > 1 ? true : original(id);
    };
    const result = await runner.run({ ...base, agent: agent(), input: 'cancel me' });
    expect(result.status).toBe('cancelled');
  });

  it('retries retryable provider errors and then succeeds', async () => {
    const err = new AiProviderError({ provider: 'mock', code: 'rate_limited', message: '429' });
    const { runner, usage } = setup([{ error: err }, { text: 'recovered' }]);
    const result = await runner.run({ ...base, agent: agent(), input: 'hi' });
    expect(result.status).toBe('succeeded');
    expect(result.output).toBe('recovered');
    expect(usage.entries.filter((e) => e.status === 'success')).toHaveLength(1);
  });

  it('fails cleanly on non-retryable provider errors', async () => {
    const err = new AiProviderError({ provider: 'mock', code: 'auth', message: 'bad key', retryable: false });
    const { runner, usage, store } = setup([{ error: err }]);
    const result = await runner.run({ ...base, agent: agent(), input: 'hi' });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('bad key');
    expect(usage.entries[0]?.status).toBe('error');
    expect(store.steps.get('exec-1')?.[0]?.type).toBe('error');
  });

  it('estimates cost only when pricing is configured', async () => {
    const pricing = new PricingTable([{ provider: 'mock', model: 'mock-chat', inputPerMillionUsd: 1, outputPerMillionUsd: 2 }]);
    const { runner } = setup([{ text: 'priced' }], { pricing });
    const result = await runner.run({ ...base, agent: agent(), input: 'hello' });
    expect(result.estimatedCostUsd).not.toBeNull();
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });

  describe('delegation', () => {
    const childId = '22222222-2222-4222-8222-222222222222';
    const parentId = '11111111-1111-4111-8111-111111111111';

    it('delegates to another agent, records a child execution and aggregates the result', async () => {
      const provider = new MockProvider({
        script: [
          { toolCalls: [{ name: 'agents__delegate', input: { agentId: childId, task: 'Research the market' } }] }, // parent step 1
          { text: 'Child research complete.' }, // child answer
          { text: 'Based on the research: done.' }, // parent final
        ],
      });
      const child = agent({ id: childId, name: 'Researcher' });
      const parent = agent({ id: parentId, permissions: { allowWrite: false, allowDelegation: true, delegateTo: [] } });
      const { runner, store } = setup([], { agents: [child, parent], sharedProvider: provider });
      const result = await runner.run({ ...base, agent: parent, input: 'Plan a launch' });
      expect(result.status).toBe('succeeded');
      expect(store.children).toHaveLength(1);
      expect(store.children[0]?.depth).toBe(1);
      expect(store.finished.get('child-1')?.status).toBe('succeeded');
      const delegationStep = store.steps.get('exec-1')?.find((s) => s.type === 'delegation');
      expect(delegationStep?.status).toBe('succeeded');
    });

    it('refuses cycles and respects the delegateTo allow-list', async () => {
      const provider = new MockProvider({
        script: [
          { toolCalls: [{ name: 'agents__delegate', input: { agentId: parentId, task: 'call yourself' } }] },
          { toolCalls: [{ name: 'agents__delegate', input: { agentId: childId, task: 'not allowed target' } }] },
          { text: 'gave up' },
        ],
      });
      const other = '33333333-3333-4333-8333-333333333333';
      const parent = agent({ id: parentId, permissions: { allowWrite: false, allowDelegation: true, delegateTo: [other] } });
      const { runner, store } = setup([], { agents: [parent, agent({ id: childId })], sharedProvider: provider });
      const result = await runner.run({ ...base, agent: parent, input: 'x' });
      expect(result.status).toBe('succeeded');
      expect(store.children).toHaveLength(0);
      const delegationSteps = store.steps.get('exec-1')?.filter((s) => s.type === 'delegation') ?? [];
      expect(delegationSteps.map((s) => s.error)).toEqual(['delegation_cycle', 'delegation_not_allowed']);
    });

    it('does not expose delegation tools when the agent may not delegate or depth is exhausted', async () => {
      const provider = new MockProvider({ script: [{ text: 'ok' }] });
      const parent = agent({ id: parentId, permissions: { allowWrite: false, allowDelegation: false, delegateTo: [] } });
      const { runner } = setup([], { sharedProvider: provider });
      await runner.run({ ...base, agent: parent, input: 'x' });
      const toolNames = provider.requests[0]?.tools?.map((t) => t.name) ?? [];
      expect(toolNames).not.toContain('agents__delegate');

      const provider2 = new MockProvider({ script: [{ text: 'ok' }] });
      const deep = agent({ id: parentId, permissions: { allowWrite: false, allowDelegation: true, delegateTo: [] } });
      const { runner: runner2 } = setup([], { sharedProvider: provider2 });
      await runner2.run({ ...base, agent: deep, input: 'x', depth: 2 });
      expect(provider2.requests[0]?.tools?.map((t) => t.name) ?? []).not.toContain('agents__delegate');
    });
  });
});
