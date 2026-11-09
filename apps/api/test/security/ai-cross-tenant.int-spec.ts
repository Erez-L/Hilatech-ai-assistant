import { ErrorCode, type Role } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from '../setup/test-app';

/**
 * Tenant isolation for the AI platform: org A users must never see or touch org B provider configs,
 * prompt templates, assistant threads, agents or executions — neither through a forged header (403
 * NOT_A_MEMBER) nor by guessing ids while scoped to their own organization (404, never 403). Assistant
 * threads are additionally private to the user who owns them, even inside the same organization.
 */
describe('Security: AI cross-tenant isolation', () => {
  let ctx: TestContext;
  let userA: Actor;
  let memberA: Actor;
  let userB: Actor;
  let orgA: string;
  let orgB: string;
  let providerB: string;
  let promptB: string;
  let threadB: string;
  let agentB: string;
  let executionB: string;
  let threadA: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    userA = await register(ctx, { firstName: 'Alice', lastName: 'A' });
    memberA = await register(ctx, { firstName: 'Mel', lastName: 'Member' });
    userB = await register(ctx, { firstName: 'Bob', lastName: 'B' });
    orgA = (await createOrganization(ctx, userA, 'Org A')).id;
    orgB = (await createOrganization(ctx, userB, 'Org B')).id;
    const rolesA = (await as(ctx, userA, orgA).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgA,
        userId: memberA.user.id,
        roleId: rolesA.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });

    // Org B data
    providerB = (
      await as(ctx, userB, orgB)
        .post('/api/v1/ai/providers')
        .send({ provider: 'mock', name: 'B mock', defaultModel: 'mock-chat' })
    ).body.data.id;
    promptB = (
      await as(ctx, userB, orgB)
        .post('/api/v1/ai/prompts')
        .send({ key: 'b.secret', name: 'B secret', content: 'B-only {{x}}' })
    ).body.data.id;
    threadB = (await as(ctx, userB, orgB).post('/api/v1/assistant/threads').send({})).body.data.id;
    await as(ctx, userB, orgB)
      .post(`/api/v1/assistant/threads/${threadB}/messages`)
      .send({ content: 'B confidential question' });
    agentB = (
      await as(ctx, userB, orgB)
        .post('/api/v1/agents')
        .send({ name: 'B agent', instructions: 'B only', tools: ['time.now'] })
    ).body.data.id;
    executionB = (
      await as(ctx, userB, orgB)
        .post(`/api/v1/agents/${agentB}/execute`)
        .send({ input: 'B task', mode: 'sync' })
    ).body.data.id;

    // Org A: a provider so the assistant works, and a thread owned by userA
    await as(ctx, userA, orgA)
      .post('/api/v1/ai/providers')
      .send({ provider: 'mock', name: 'A mock', defaultModel: 'mock-chat' });
    threadA = (await as(ctx, userA, orgA).post('/api/v1/assistant/threads').send({})).body.data.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('refuses a forged organization header outright (403 NOT_A_MEMBER)', async () => {
    const res = await as(ctx, userA, orgB).get('/api/v1/ai/providers');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
    expect((await as(ctx, userA, orgB).get('/api/v1/agents')).status).toBe(403);
    expect((await as(ctx, userA, orgB).get('/api/v1/assistant/threads')).status).toBe(403);
  });

  it('answers 404 for org B provider configs, prompts, agents and executions addressed from org A', async () => {
    const a = as(ctx, userA, orgA);
    const attempts = [
      a.get(`/api/v1/ai/providers/${providerB}`),
      a.patch(`/api/v1/ai/providers/${providerB}`).send({ name: 'hijack' }),
      a.delete(`/api/v1/ai/providers/${providerB}`),
      a.post(`/api/v1/ai/providers/${providerB}/health`),
      a.get(`/api/v1/ai/prompts/${promptB}`),
      a.patch(`/api/v1/ai/prompts/${promptB}`).send({ name: 'hijack' }),
      a.delete(`/api/v1/ai/prompts/${promptB}`),
      a.post(`/api/v1/ai/prompts/${promptB}/render`).send({ variables: {} }),
      a.get(`/api/v1/agents/${agentB}`),
      a.patch(`/api/v1/agents/${agentB}`).send({ name: 'hijack' }),
      a.delete(`/api/v1/agents/${agentB}`),
      a.post(`/api/v1/agents/${agentB}/execute`).send({ input: 'steal' }),
      a.get(`/api/v1/agents/executions/${executionB}`),
      a.post(`/api/v1/agents/executions/${executionB}/cancel`),
    ];
    for (const attempt of attempts) {
      const res = await attempt;
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
    }
  });

  it('keeps assistant threads private: other organizations and other members get 404', async () => {
    const foreign = as(ctx, userA, orgA);
    expect((await foreign.get(`/api/v1/assistant/threads/${threadB}`)).status).toBe(404);
    expect((await foreign.get(`/api/v1/assistant/threads/${threadB}/messages`)).status).toBe(404);
    expect(
      (await foreign.post(`/api/v1/assistant/threads/${threadB}/messages`).send({ content: 'hi' }))
        .status,
    ).toBe(404);
    expect((await foreign.delete(`/api/v1/assistant/threads/${threadB}`)).status).toBe(404);

    // Same organization, different user: still invisible.
    const otherMember = as(ctx, memberA, orgA);
    expect((await otherMember.get(`/api/v1/assistant/threads/${threadA}`)).status).toBe(404);
    expect((await otherMember.get(`/api/v1/assistant/threads/${threadA}/messages`)).status).toBe(
      404,
    );
    expect(
      (
        await otherMember
          .post(`/api/v1/assistant/threads/${threadA}/messages`)
          .send({ content: 'x' })
      ).status,
    ).toBe(404);
    expect((await otherMember.get('/api/v1/assistant/threads')).body.meta.total).toBe(0);
  });

  it('lists never leak across organizations', async () => {
    const a = as(ctx, userA, orgA);
    const providers = await a.get('/api/v1/ai/providers');
    expect(providers.body.data.map((p: { id: string }) => p.id)).not.toContain(providerB);
    const prompts = await a.get('/api/v1/ai/prompts');
    expect(prompts.body.meta.total).toBe(0);
    const agents = await a.get('/api/v1/agents');
    expect(agents.body.meta.total).toBe(0);
    const executions = await a.get('/api/v1/agents/executions');
    expect(executions.body.meta.total).toBe(0);
    const usage = await a.get('/api/v1/ai/usage/summary');
    expect(usage.body.data.requests).toBe(0);
    const requests = await a.get('/api/v1/ai/usage/requests');
    expect(requests.body.meta.total).toBe(0);
  });

  it('rejects org B references inside org A payloads as validation errors', async () => {
    const a = as(ctx, userA, orgA);
    const thread = await a.post('/api/v1/assistant/threads').send({ providerConfigId: providerB });
    expect(thread.status).toBe(400);
    expect(thread.body.error.details[0].path).toBe('providerConfigId');
    const agent = await a
      .post('/api/v1/agents')
      .send({ name: 'A agent', instructions: 'x', providerConfigId: providerB });
    expect(agent.status).toBe(400);
    const delegating = await a.post('/api/v1/agents').send({
      name: 'A delegator',
      instructions: 'x',
      permissions: { allowDelegation: true, delegateTo: [agentB] },
    });
    expect(delegating.status).toBe(400);
    expect(delegating.body.error.details[0].path).toBe('permissions.delegateTo');

    // Org B's lead must not be loadable as assistant context from org A.
    const leadB = await ctx.prisma.client.lead.create({
      data: { organizationId: orgB, title: 'B deal', status: 'new', source: 'other' },
    });
    const ctxRes = await a
      .post(`/api/v1/assistant/threads/${threadA}/messages`)
      .send({ content: 'Tell me about this lead', context: { leadId: leadB.id } });
    expect(ctxRes.status).toBe(400);
    expect(ctxRes.body.error.details[0].path).toBe('context.leadId');
  });

  it('member role in org A cannot manage AI configuration or agents', async () => {
    const m = as(ctx, memberA, orgA);
    expect((await m.get('/api/v1/ai/providers')).status).toBe(403);
    expect((await m.get('/api/v1/ai/prompts')).status).toBe(403);
    expect((await m.get('/api/v1/ai/usage/summary')).status).toBe(403);
    expect(
      (
        await m
          .post('/api/v1/ai/providers')
          .send({ provider: 'mock', name: 'x', defaultModel: 'mock-chat' })
      ).status,
    ).toBe(403);
    expect((await m.post('/api/v1/agents').send({ name: 'x', instructions: 'x' })).status).toBe(
      403,
    );
    expect((await m.get('/api/v1/agents')).status).toBe(200);
    expect((await m.get('/api/v1/ai/tools')).status).toBe(200);
  });
});
