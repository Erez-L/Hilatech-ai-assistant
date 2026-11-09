import {
  type AiUsageSummary,
  type AssistantMessage,
  type AssistantThread,
  AuditAction,
  ErrorCode,
  type Role,
} from '@hilatech/contracts';
import request from 'supertest';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from './setup/test-app';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/** Parses an SSE body into `{ type, data }` events. */
function parseSse(text: string): Array<{ event: string; data: Record<string, unknown> }> {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))!.slice('event: '.length);
      const data = lines.find((l) => l.startsWith('data: '))!.slice('data: '.length);
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

describe('Assistant threads and messages (mock provider)', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let orgId: string;
  let thread: AssistantThread;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    orgId = (await createOrganization(ctx, owner, 'Assist Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('creates a thread (member role may use the assistant)', async () => {
    const res = await as(ctx, member, orgId).post('/api/v1/assistant/threads').send({});
    expect(res.status).toBe(201);
    thread = res.body.data;
    expect(thread).toMatchObject({
      organizationId: orgId,
      userId: member.user.id,
      title: null,
      providerConfigId: null,
      model: null,
      messageCount: 0,
      lastMessageAt: null,
    });
    const bad = await as(ctx, member, orgId)
      .post('/api/v1/assistant/threads')
      .send({ providerConfigId: UNKNOWN_ID });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('providerConfigId');
  });

  it('answers 409 AI_NOT_CONFIGURED while the organization has no provider (nothing persisted)', async () => {
    const res = await as(ctx, member, orgId)
      .post(`/api/v1/assistant/threads/${thread.id}/messages`)
      .send({ content: 'Hello?' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ErrorCode.AI_NOT_CONFIGURED);
    const count = await ctx.prisma.client.assistantMessage.count({
      where: { threadId: thread.id },
    });
    expect(count).toBe(0);
  });

  describe('with a mock provider configured', () => {
    beforeAll(async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/ai/providers')
        .send({ provider: 'mock', name: 'Mock', defaultModel: 'mock-chat' });
      expect(res.status).toBe(201);
    });

    it('round-trips a message: reply persisted, title set, counters bumped, usage recorded', async () => {
      const res = await as(ctx, member, orgId)
        .post(`/api/v1/assistant/threads/${thread.id}/messages`)
        .send({ content: 'What is on my plate today?' });
      expect(res.status).toBe(200);
      const message = res.body.data.message as AssistantMessage;
      expect(message).toMatchObject({
        threadId: thread.id,
        role: 'assistant',
        content: 'mock: What is on my plate today?',
        toolCalls: null,
      });
      expect(message.inputTokens).toBeGreaterThan(0);
      expect(message.outputTokens).toBeGreaterThan(0);
      expect(message.metadata).toMatchObject({ status: 'succeeded', stepCount: 2 });
      expect(res.body.data.usage.inputTokens).toBe(message.inputTokens);

      const messages = await as(ctx, member, orgId).get(
        `/api/v1/assistant/threads/${thread.id}/messages`,
      );
      expect(messages.status).toBe(200);
      expect(messages.body.data.map((m: AssistantMessage) => m.role)).toEqual([
        'user',
        'assistant',
      ]);
      expect(messages.body.data[0].content).toBe('What is on my plate today?');

      const updated = await as(ctx, member, orgId).get(`/api/v1/assistant/threads/${thread.id}`);
      expect(updated.body.data).toMatchObject({
        title: 'What is on my plate today?',
        messageCount: 2,
      });
      expect(updated.body.data.lastMessageAt).toBeTruthy();

      const log = await ctx.prisma.client.aiRequestLog.findMany({
        where: { organizationId: orgId, threadId: thread.id },
      });
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        provider: 'mock',
        model: 'mock-chat',
        operation: 'generate',
        status: 'success',
        userId: member.user.id,
        agentId: null,
        executionId: null,
        estimatedCostUsd: null,
      });
      const usage = await ctx.prisma.client.usageRecord.findMany({
        where: { organizationId: orgId, metric: 'ai_tokens' },
      });
      expect(usage).toHaveLength(1);
      expect(Number(usage[0]!.quantity)).toBe(message.inputTokens! + message.outputTokens!);
    });

    it('streams the reply as SSE when asked for text/event-stream', async () => {
      const res = await request(ctx.http)
        .post(`/api/v1/assistant/threads/${thread.id}/messages`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .set('x-organization-id', orgId)
        .set('Accept', 'text/event-stream')
        .send({ content: 'Stream this please' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['cache-control']).toContain('no-cache');
      expect(res.text).toContain('event: message_end');

      const events = parseSse(res.text);
      expect(events[0]!.event).toBe('message_start');
      const userRow = await ctx.prisma.client.assistantMessage.findUniqueOrThrow({
        where: { id: events[0]!.data.messageId as string },
      });
      expect(userRow).toMatchObject({ role: 'user', content: 'Stream this please' });

      const deltas = events.filter((e) => e.event === 'text_delta');
      expect(deltas.length).toBeGreaterThan(1);
      expect(deltas.map((d) => d.data.delta).join('')).toBe('mock: Stream this please');

      const end = events[events.length - 1]!;
      expect(end.event).toBe('message_end');
      expect(end.data.message).toMatchObject({
        role: 'assistant',
        content: 'mock: Stream this please',
      });
      expect((end.data.usage as { inputTokens: number }).inputTokens).toBeGreaterThan(0);
      // Every event body carries its own `type`, matching the SSE event name.
      for (const e of events) expect(e.data.type).toBe(e.event);

      const log = await ctx.prisma.client.aiRequestLog.findMany({
        where: { threadId: thread.id, operation: 'stream' },
      });
      expect(log).toHaveLength(1);
    });

    it('passes CRM context as data blocks and rejects references outside the organization', async () => {
      const contact = (
        await as(ctx, owner, orgId)
          .post('/api/v1/contacts')
          .send({ firstName: 'Dana', lastName: 'Deal', email: 'dana@example.com' })
      ).body.data;
      const lead = (
        await as(ctx, owner, orgId)
          .post('/api/v1/leads')
          .send({ title: 'Website redesign', contactId: contact.id, value: 1200 })
      ).body.data;

      const ok = await as(ctx, member, orgId)
        .post(`/api/v1/assistant/threads/${thread.id}/messages`)
        .send({
          content: 'Summarise this lead',
          context: { leadId: lead.id, contactId: contact.id },
        });
      expect(ok.status).toBe(200);
      expect(ok.body.data.message.content).toBe('mock: Summarise this lead');

      const bad = await as(ctx, member, orgId)
        .post(`/api/v1/assistant/threads/${thread.id}/messages`)
        .send({ content: 'x', context: { leadId: UNKNOWN_ID } });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details[0].path).toBe('context.leadId');
    });

    it('replays a history containing tool calls and tool results through the engine', async () => {
      // The mock provider only echoes, so the stored shape is seeded directly: a previous turn where
      // the assistant called a tool and the tool row answered it.
      const seeded = await ctx.prisma.client.assistantThread.create({
        data: { organizationId: orgId, userId: member.user.id, title: 'Seeded' },
      });
      const base = Date.now();
      await ctx.prisma.client.assistantMessage.createMany({
        data: [
          { threadId: seeded.id, role: 'user', content: 'When is it?', createdAt: new Date(base) },
          {
            threadId: seeded.id,
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'time.now', input: {} }],
            createdAt: new Date(base + 1),
          },
          {
            threadId: seeded.id,
            role: 'tool',
            content: JSON.stringify({ ok: true, data: { iso: '2026-11-09T00:00:00.000Z' } }),
            toolCallId: 'call_1',
            toolName: 'time.now',
            createdAt: new Date(base + 2),
          },
          {
            threadId: seeded.id,
            role: 'assistant',
            content: 'It is the 9th.',
            createdAt: new Date(base + 3),
          },
        ],
      });
      const res = await as(ctx, member, orgId)
        .post(`/api/v1/assistant/threads/${seeded.id}/messages`)
        .send({ content: 'Thanks, and now?' });
      expect(res.status).toBe(200);
      expect(res.body.data.message.content).toBe('mock: Thanks, and now?');
      const list = await as(ctx, member, orgId).get(
        `/api/v1/assistant/threads/${seeded.id}/messages?sortOrder=asc`,
      );
      const roles = (list.body.data as AssistantMessage[]).map((m) => m.role);
      expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant', 'user', 'assistant']);
      expect(list.body.data[1].toolCalls).toEqual([{ id: 'call_1', name: 'time.now', input: {} }]);
      expect(list.body.data[2]).toMatchObject({ toolCallId: 'call_1', toolName: 'time.now' });
    });

    it("lists only the caller's threads, supports rename/delete, and the usage summary sees the requests", async () => {
      const ownerThreads = await as(ctx, owner, orgId).get('/api/v1/assistant/threads');
      expect(ownerThreads.body.meta.total).toBe(0);
      const memberThreads = await as(ctx, member, orgId).get('/api/v1/assistant/threads');
      expect(memberThreads.body.meta.total).toBe(2);
      const listed = memberThreads.body.data as AssistantThread[];
      expect(listed.map((t) => t.id)).toContain(thread.id);
      // Most recent activity first (the seeded thread received the latest turn).
      expect(new Date(listed[0]!.lastMessageAt!).getTime()).toBeGreaterThanOrEqual(
        new Date(listed[1]!.lastMessageAt!).getTime(),
      );

      const renamed = await as(ctx, member, orgId)
        .patch(`/api/v1/assistant/threads/${thread.id}`)
        .send({ title: 'Daily plan' });
      expect(renamed.body.data.title).toBe('Daily plan');
      expect(
        (await as(ctx, owner, orgId).get(`/api/v1/assistant/threads/${thread.id}`)).status,
      ).toBe(404);

      const summary = await as(ctx, owner, orgId).get('/api/v1/ai/usage/summary');
      expect(summary.status).toBe(200);
      const data = summary.body.data as AiUsageSummary;
      expect(data.requests).toBe(4);
      expect(data.totalTokens).toBeGreaterThan(0);
      expect(data.estimatedCostUsd).toBeNull(); // no pricing configured → never invented
      expect(data.byModel).toEqual([
        expect.objectContaining({ provider: 'mock', model: 'mock-chat', requests: 4 }),
      ]);
      expect(data.byAgent).toEqual([expect.objectContaining({ agentId: null, requests: 4 })]);
      expect(data.limit.used).toBe(data.totalTokens);

      const requests = await as(ctx, owner, orgId).get('/api/v1/ai/usage/requests');
      expect(requests.body.meta.total).toBe(4);
      expect(requests.body.data[0]).toMatchObject({ provider: 'mock', status: 'success' });

      const deleted = await as(ctx, member, orgId).delete(`/api/v1/assistant/threads/${thread.id}`);
      expect(deleted.status).toBe(204);
      expect(
        await ctx.prisma.client.assistantMessage.count({ where: { threadId: thread.id } }),
      ).toBe(0);
    });

    it('refuses the assistant when the plan token limit is exhausted (402)', async () => {
      await ctx.prisma.client.subscription.update({
        where: { organizationId: orgId },
        data: {
          limits: {
            seats: 5,
            aiTokensPerMonth: 1,
            agents: 1,
            knowledgeDocuments: 1,
            storageMb: 1,
            automations: 1,
          },
        },
      });
      const t = (await as(ctx, member, orgId).post('/api/v1/assistant/threads').send({})).body.data;
      const res = await as(ctx, member, orgId)
        .post(`/api/v1/assistant/threads/${t.id}/messages`)
        .send({ content: 'Over the limit' });
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe(ErrorCode.ENTITLEMENT_EXCEEDED);
      await ctx.prisma.client.subscription.update({
        where: { organizationId: orgId },
        data: {
          limits: {
            seats: 5,
            aiTokensPerMonth: 100_000,
            agents: 5,
            knowledgeDocuments: 10,
            storageMb: 100,
            automations: 5,
          },
        },
      });
      const audit = await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.AI_TOOL_EXECUTED },
      });
      expect(audit).toBe(0); // the mock never called tools in this suite
    });
  });
});
