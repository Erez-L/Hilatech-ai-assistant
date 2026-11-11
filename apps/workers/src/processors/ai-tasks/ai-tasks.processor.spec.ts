import { AiNotConfiguredError, AiProviderError, MockProvider } from '@hilatech/ai-engine';
import { QueueName } from '@hilatech/contracts';
import type { Job } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import type { AiRuntime } from '../../ai/ai-runtime';
import type { JobContext, JobPayload } from '../../queue/job-processor';
import {
  AiTasksProcessor,
  buildTranscript,
  normaliseExecutionInput,
  SUMMARY_MESSAGE_LIMIT,
} from './ai-tasks.processor';

type Payload = JobPayload<typeof QueueName.AI_TASKS>;

const organizationId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const agentId = '11111111-1111-4111-8111-111111111111';
const executionId = '44444444-4444-4444-8444-444444444444';
const conversationId = '55555555-5555-4555-8555-555555555555';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as PinoLogger;

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: agentId,
    organizationId,
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
    maxDurationMs: 60_000,
    maxTokens: 50_000,
    maxDelegations: 3,
    retryPolicy: { maxAttempts: 2, backoffMs: 1 },
    isEnabled: true,
    ...overrides,
  };
}

function executionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: executionId,
    organizationId,
    agentId,
    parentExecutionId: null,
    rootExecutionId: null,
    triggeredByUserId: userId,
    trigger: 'manual',
    status: 'queued',
    input: 'What time is it?',
    depth: 0,
    agent: agentRow(),
    organization: { name: 'Acme' },
    ...overrides,
  };
}

function setup() {
  const agentExecution = { findFirst: jest.fn(), update: jest.fn() };
  const organizationMember = { findFirst: jest.fn() };
  const conversation = { findFirst: jest.fn(), update: jest.fn() };
  const runner = { run: jest.fn() };
  const store = { finish: jest.fn() };
  const usage = { record: jest.fn().mockResolvedValue({ estimatedCostUsd: null }) };
  const resolver = { forOrganization: jest.fn(), forAgent: jest.fn() };
  const runtime = {
    prisma: { client: { agentExecution, organizationMember, conversation } },
    runner,
    checkBudget: jest.fn().mockResolvedValue({ blocked: false }),
    store,
    usage,
    resolver,
  } as unknown as AiRuntime;
  const processor = new AiTasksProcessor(runtime, logger);
  return {
    processor,
    agentExecution,
    organizationMember,
    conversation,
    runner,
    store,
    usage,
    resolver,
  };
}

const payload = (overrides: Partial<Payload> = {}): Payload => ({
  organizationId,
  idempotencyKey: `ai-exec-${executionId}`,
  enqueuedAt: new Date().toISOString(),
  kind: 'agent_execution',
  targetId: executionId,
  requestedByUserId: userId,
  ...overrides,
});

const context: JobContext = {
  queue: QueueName.AI_TASKS,
  jobId: 'job-1',
  jobName: 'ai-tasks',
  attempt: 1,
  maxAttempts: 5,
  organizationId,
  idempotencyKey: `ai-exec-${executionId}`,
  requestId: undefined,
};

const asJob = (data: Payload): Job<Payload> => ({ id: 'job-1', data }) as unknown as Job<Payload>;

const activeOwner = {
  status: 'active',
  user: { isActive: true },
  role: { key: 'owner', isSystem: true, permissions: ['agents:execute'] },
};

describe('AiTasksProcessor — agent_execution', () => {
  it('skips with not_found when the execution does not exist in the organization', async () => {
    const { processor, agentExecution, runner } = setup();
    agentExecution.findFirst.mockResolvedValue(null);

    const outcome = await processor.process(asJob(payload()), context);

    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'not_found',
      kind: 'agent_execution',
      executionId,
    });
    expect(agentExecution.findFirst.mock.calls[0]![0].where).toEqual({
      id: executionId,
      organizationId,
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('skips with already_processed when the execution is no longer queued', async () => {
    const { processor, agentExecution, runner } = setup();
    agentExecution.findFirst.mockResolvedValue(executionRow({ status: 'succeeded' }));

    const outcome = await processor.process(asJob(payload()), context);

    expect(outcome).toMatchObject({
      status: 'skipped',
      reason: 'already_processed',
      executionStatus: 'succeeded',
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('fails the execution without running when the agent is disabled', async () => {
    const { processor, agentExecution, runner, store } = setup();
    agentExecution.findFirst.mockResolvedValue(
      executionRow({ agent: agentRow({ isEnabled: false }) }),
    );

    const outcome = await processor.process(asJob(payload()), context);

    expect(outcome).toEqual({
      status: 'completed',
      kind: 'agent_execution',
      executionId,
      result: { status: 'failed', stepCount: 0, error: 'Agent is disabled' },
    });
    expect(store.finish).toHaveBeenCalledWith(
      executionId,
      expect.objectContaining({ status: 'failed', error: 'Agent is disabled', stepCount: 0 }),
    );
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("runs a queued execution with the triggering user's permissions and reports the result", async () => {
    const { processor, agentExecution, organizationMember, runner } = setup();
    agentExecution.findFirst.mockResolvedValue(executionRow());
    organizationMember.findFirst.mockResolvedValue(activeOwner);
    runner.run.mockResolvedValue({
      status: 'succeeded',
      output: 'done',
      error: null,
      stepCount: 2,
      usage: { inputTokens: 10, outputTokens: 5 },
      durationMs: 42,
      estimatedCostUsd: null,
      transcript: [],
    });

    const outcome = await processor.process(asJob(payload()), context);

    expect(outcome).toEqual({
      status: 'completed',
      kind: 'agent_execution',
      executionId,
      result: { status: 'succeeded', stepCount: 2, durationMs: 42, error: null },
    });
    expect(runner.run).toHaveBeenCalledTimes(1);
    const request = runner.run.mock.calls[0]![0];
    expect(request).toMatchObject({
      executionId,
      input: 'What time is it?',
      userId,
      trigger: 'manual',
      depth: 0,
      rootExecutionId: executionId,
      ancestry: [],
      organizationName: 'Acme',
    });
    expect(request.agent).toMatchObject({ id: agentId, tools: ['time.now'], isEnabled: true });
    expect(request.userPermissions).toContain('agents:execute');
    expect(request.userPermissions).toContain('leads:read'); // owner → every permission
    expect(agentExecution.update).not.toHaveBeenCalled();
  });

  it('passes object inputs through and keeps the stored rootExecutionId for child executions', async () => {
    const { processor, agentExecution, runner } = setup();
    const root = '66666666-6666-4666-8666-666666666666';
    agentExecution.findFirst.mockResolvedValue(
      executionRow({
        input: { task: 'qualify', leadId: 'L-1' },
        triggeredByUserId: null,
        trigger: 'automation',
        rootExecutionId: root,
        depth: 1,
      }),
    );
    runner.run.mockResolvedValue({
      status: 'succeeded',
      output: 'ok',
      error: null,
      stepCount: 1,
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
      estimatedCostUsd: null,
      transcript: [],
    });

    await processor.process(asJob(payload()), context);

    expect(runner.run.mock.calls[0]![0]).toMatchObject({
      input: { task: 'qualify', leadId: 'L-1' },
      userId: null,
      userPermissions: null, // automation: admin-configured grants apply
      trigger: 'automation',
      rootExecutionId: root,
      depth: 1,
    });
  });

  it('runs with empty permissions when the triggering user is not an active member and notes it on failure', async () => {
    const { processor, agentExecution, organizationMember, runner } = setup();
    agentExecution.findFirst.mockResolvedValue(executionRow());
    organizationMember.findFirst.mockResolvedValue(null);
    runner.run.mockResolvedValue({
      status: 'failed',
      output: null,
      error: 'Execution limit exceeded: steps (7 > 6)',
      stepCount: 6,
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 5,
      estimatedCostUsd: null,
      transcript: [],
    });

    const outcome = await processor.process(asJob(payload()), context);

    expect(runner.run.mock.calls[0]![0].userPermissions).toEqual([]);
    expect(outcome).toMatchObject({ status: 'completed', result: { status: 'failed' } });
    expect(agentExecution.update).toHaveBeenCalledWith({
      where: { id: executionId },
      data: {
        error: expect.stringMatching(
          /^Execution limit exceeded: steps \(7 > 6\) Triggering user is not an active member .*\(missing\)/,
        ),
      },
    });
  });

  it('does not swallow infrastructure errors (BullMQ retries them)', async () => {
    const { processor, agentExecution } = setup();
    agentExecution.findFirst.mockRejectedValue(new Error('connection reset'));
    await expect(processor.process(asJob(payload()), context)).rejects.toThrow('connection reset');
  });
});

describe('AiTasksProcessor — conversation_summary', () => {
  const summaryPayload = () =>
    payload({ kind: 'conversation_summary', targetId: conversationId, requestedByUserId: null });

  function conversationRow(messageCount = 2) {
    const messages = Array.from({ length: messageCount }, (_, i) => ({
      role: i % 2 === 0 ? 'customer' : 'agent',
      content: `message ${messageCount - i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 10, messageCount - i)),
      author: i % 2 === 0 ? null : { firstName: 'Dana', lastName: 'Levi' },
    }));
    return {
      id: conversationId,
      subject: 'Pricing question',
      channel: 'email',
      status: 'open',
      organization: { name: 'Acme' },
      messages, // newest first, as the query orders them
    };
  }

  function resolvedMock(provider: MockProvider) {
    return {
      provider,
      providerKind: 'mock' as const,
      providerConfigId: 'cfg-1',
      model: 'mock-chat',
      contextWindow: 32_000,
    };
  }

  it('skips with not_found when the conversation is missing', async () => {
    const { processor, conversation, resolver } = setup();
    conversation.findFirst.mockResolvedValue(null);
    const outcome = await processor.process(asJob(summaryPayload()), context);
    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'not_found',
      kind: 'conversation_summary',
      conversationId,
    });
    expect(conversation.findFirst.mock.calls[0]![0].where).toEqual({
      id: conversationId,
      organizationId,
    });
    expect(conversation.findFirst.mock.calls[0]![0].select.messages.take).toBe(
      SUMMARY_MESSAGE_LIMIT,
    );
    expect(resolver.forOrganization).not.toHaveBeenCalled();
  });

  it('skips with no_messages for an empty conversation', async () => {
    const { processor, conversation } = setup();
    conversation.findFirst.mockResolvedValue(conversationRow(0));
    expect(await processor.process(asJob(summaryPayload()), context)).toMatchObject({
      status: 'skipped',
      reason: 'no_messages',
    });
  });

  it('skips with ai_not_configured when the organization has no usable provider', async () => {
    const { processor, conversation, resolver } = setup();
    conversation.findFirst.mockResolvedValue(conversationRow());
    resolver.forOrganization.mockRejectedValue(new AiNotConfiguredError());
    expect(await processor.process(asJob(summaryPayload()), context)).toMatchObject({
      status: 'skipped',
      reason: 'ai_not_configured',
    });

    resolver.forOrganization.mockRejectedValue(
      new AiProviderError({ provider: 'mock', code: 'unsupported', message: 'mock refused' }),
    );
    expect(await processor.process(asJob(summaryPayload()), context)).toMatchObject({
      status: 'skipped',
      reason: 'ai_not_configured',
    });
  });

  it('stores the summary, records usage and returns sentiment/next steps', async () => {
    const { processor, conversation, resolver, usage } = setup();
    conversation.findFirst.mockResolvedValue(conversationRow(3));
    const provider = new MockProvider({
      script: [
        {
          structured: {
            summary: 'Customer asked about pricing; agent sent the price list.',
            sentiment: 'positive',
            nextSteps: ['Follow up next week'],
          },
        },
      ],
    });
    resolver.forOrganization.mockResolvedValue(resolvedMock(provider));

    const outcome = await processor.process(asJob(summaryPayload()), context);

    expect(outcome).toEqual({
      status: 'completed',
      kind: 'conversation_summary',
      conversationId,
      summarized: true,
      sentiment: 'positive',
      nextSteps: ['Follow up next week'],
    });
    expect(resolver.forOrganization).toHaveBeenCalledWith(organizationId);
    expect(conversation.update).toHaveBeenCalledWith({
      where: { id: conversationId },
      data: { summary: 'Customer asked about pricing; agent sent the price list.' },
    });
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        userId: null,
        agentId: null,
        executionId: null,
        provider: 'mock',
        model: 'mock-chat',
        operation: 'structured',
        status: 'success',
      }),
    );
    // The prompt carries the transcript as a data block, in chronological order, with the hardening rules.
    const request = provider.requests[0]!;
    expect(request.system).toMatch(/untrusted DATA/);
    expect(request.system).toMatch(/organization "Acme"/);
    const text = (request.messages[0]!.parts[0] as { text: string }).text;
    expect(text).toMatch(/<data source="conversation">/);
    expect(text.indexOf('message 1')).toBeLessThan(text.indexOf('message 3'));
    expect(text).toMatch(/agent \(Dana Levi\): message 2/);
  });

  it('completes with summarized=false when the model output is not valid JSON (no retry storm)', async () => {
    const { processor, conversation, resolver, usage } = setup();
    conversation.findFirst.mockResolvedValue(conversationRow());
    // An unscripted MockProvider echoes the prompt as text → generateStructured rejects it.
    resolver.forOrganization.mockResolvedValue(resolvedMock(new MockProvider()));

    const outcome = await processor.process(asJob(summaryPayload()), context);

    expect(outcome).toMatchObject({
      status: 'completed',
      summarized: false,
      reason: 'invalid_request',
    });
    expect(conversation.update).not.toHaveBeenCalled();
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', errorCode: 'invalid_request' }),
    );
  });

  it('rethrows retryable provider errors so BullMQ retries with backoff', async () => {
    const { processor, conversation, resolver, usage } = setup();
    conversation.findFirst.mockResolvedValue(conversationRow());
    resolver.forOrganization.mockResolvedValue(
      resolvedMock(
        new MockProvider({
          script: [
            {
              error: new AiProviderError({
                provider: 'mock',
                code: 'rate_limited',
                message: 'slow down',
              }),
            },
          ],
        }),
      ),
    );

    await expect(processor.process(asJob(summaryPayload()), context)).rejects.toThrow('slow down');
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', errorCode: 'rate_limited' }),
    );
    expect(conversation.update).not.toHaveBeenCalled();
  });
});

describe('AiTasksProcessor — lead_enrichment', () => {
  it('is skipped as not implemented', async () => {
    const { processor } = setup();
    const outcome = await processor.process(
      asJob(payload({ kind: 'lead_enrichment', targetId: conversationId })),
      context,
    );
    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'not_implemented',
      kind: 'lead_enrichment',
    });
  });
});

describe('helpers', () => {
  it('normaliseExecutionInput passes strings and objects through and wraps other JSON', () => {
    expect(normaliseExecutionInput('task')).toBe('task');
    expect(normaliseExecutionInput({ a: 1 })).toEqual({ a: 1 });
    expect(normaliseExecutionInput(['x'])).toEqual({ value: ['x'] });
    expect(normaliseExecutionInput(42)).toEqual({ value: 42 });
    expect(normaliseExecutionInput(null)).toEqual({ value: null });
  });

  it('buildTranscript caps long message bodies', () => {
    const line = buildTranscript(
      [{ role: 'customer', content: 'x'.repeat(50), createdAt: new Date(0) }],
      10,
    );
    expect(line).toBe(`[1970-01-01T00:00:00.000Z] customer: ${'x'.repeat(10)}…`);
  });
});
