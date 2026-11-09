import {
  type Agent,
  type AgentExecution,
  type AgentExecutionDetail,
  AuditAction,
  ErrorCode,
  QueueName,
  type Role,
} from '@hilatech/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  jobsOn,
  register,
  resetDatabase,
} from './setup/test-app';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Agents: CRUD, execution (sync + async), executions, cancel', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let orgId: string;
  let agent: Agent;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    await ctx.app.get<Queue>(getQueueToken(QueueName.AI_TASKS)).obliterate({ force: true });
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    orgId = (await createOrganization(ctx, owner, 'Agents Co')).id;
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
    await ctx.app.get<Queue>(getQueueToken(QueueName.AI_TASKS)).obliterate({ force: true });
    await ctx.close();
  });

  describe('CRUD', () => {
    it('creates an agent with defaults, strips delegation keys from tools and audits it', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/agents')
        .send({
          name: 'Research agent',
          description: 'Looks things up',
          instructions: 'You research leads.',
          tools: ['time.now', 'crm.search_leads', 'agents.delegate'],
          permissions: { allowWrite: false },
        });
      expect(res.status).toBe(201);
      agent = res.body.data;
      expect(agent).toMatchObject({
        organizationId: orgId,
        name: 'Research agent',
        tools: ['time.now', 'crm.search_leads'],
        permissions: { allowWrite: false, allowDelegation: false, delegateTo: [] },
        maxSteps: 12,
        maxDurationMs: 120_000,
        maxTokens: 150_000,
        maxDelegations: 3,
        retryPolicy: { maxAttempts: 2, backoffMs: 2000 },
        isEnabled: true,
        createdById: owner.user.id,
        createdBy: { id: owner.user.id, firstName: 'Owen' },
      });
      const audit = await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.AGENT_CREATED, targetId: agent.id },
      });
      expect(audit).toBe(1);
    });

    it('rejects unknown tools (400 listing them), foreign provider configs and bad delegation targets', async () => {
      const unknown = await as(ctx, owner, orgId)
        .post('/api/v1/agents')
        .send({
          name: 'Bad tools',
          instructions: 'x',
          tools: ['time.now', 'nope.tool', 'crm.fly'],
        });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(unknown.body.error.details[0]).toMatchObject({
        path: 'tools',
        unknown: ['nope.tool', 'crm.fly'],
      });

      const provider = await as(ctx, owner, orgId)
        .post('/api/v1/agents')
        .send({ name: 'Bad provider', instructions: 'x', providerConfigId: UNKNOWN_ID });
      expect(provider.status).toBe(400);
      expect(provider.body.error.details[0].path).toBe('providerConfigId');

      const delegation = await as(ctx, owner, orgId)
        .post('/api/v1/agents')
        .send({
          name: 'Bad delegation',
          instructions: 'x',
          permissions: { allowDelegation: true, delegateTo: [UNKNOWN_ID] },
        });
      expect(delegation.status).toBe(400);
      expect(delegation.body.error.details[0].path).toBe('permissions.delegateTo');
    });

    it('enforces unique names per organization (409)', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/agents')
        .send({
          name: 'research AGENT'.replace('research AGENT', 'Research agent'),
          instructions: 'x',
        });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCode.CONFLICT);
    });

    it('lists, filters and updates agents', async () => {
      const second = await as(ctx, owner, orgId)
        .post('/api/v1/agents')
        .send({ name: 'Writer', instructions: 'You write.', isEnabled: false });
      expect(second.status).toBe(201);

      const all = await as(ctx, member, orgId).get('/api/v1/agents');
      expect(all.status).toBe(200);
      expect(all.body.meta.total).toBe(2);
      const enabled = await as(ctx, member, orgId).get('/api/v1/agents?isEnabled=true');
      expect(enabled.body.data.map((a: Agent) => a.id)).toEqual([agent.id]);
      const search = await as(ctx, member, orgId).get('/api/v1/agents?search=writ');
      expect(search.body.data.map((a: Agent) => a.name)).toEqual(['Writer']);

      const updated = await as(ctx, owner, orgId)
        .patch(`/api/v1/agents/${agent.id}`)
        .send({
          tools: ['time.now'],
          permissions: {
            allowWrite: true,
            allowDelegation: true,
            delegateTo: [second.body.data.id],
          },
          maxSteps: 4,
        });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({
        tools: ['time.now'],
        permissions: { allowWrite: true, allowDelegation: true, delegateTo: [second.body.data.id] },
        maxSteps: 4,
      });

      const selfDelegation = await as(ctx, owner, orgId)
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ permissions: { allowDelegation: true, delegateTo: [agent.id] } });
      expect(selfDelegation.status).toBe(400);

      expect(
        (await as(ctx, owner, orgId).delete(`/api/v1/agents/${second.body.data.id}`)).status,
      ).toBe(204);
      expect(
        (await as(ctx, owner, orgId).get(`/api/v1/agents/${second.body.data.id}`)).status,
      ).toBe(404);
      // Delegation target gone → reset permissions for the execution tests below.
      await as(ctx, owner, orgId)
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ permissions: { allowWrite: false, allowDelegation: false, delegateTo: [] } });
    });

    it('denies agents:manage to the member role but lets it read and execute', async () => {
      expect(
        (await as(ctx, member, orgId).post('/api/v1/agents').send({ name: 'M', instructions: 'x' }))
          .status,
      ).toBe(403);
      expect(
        (await as(ctx, member, orgId).patch(`/api/v1/agents/${agent.id}`).send({ name: 'M' }))
          .status,
      ).toBe(403);
      expect((await as(ctx, member, orgId).delete(`/api/v1/agents/${agent.id}`)).status).toBe(403);
      expect((await as(ctx, member, orgId).get(`/api/v1/agents/${agent.id}`)).status).toBe(200);
    });
  });

  describe('execution', () => {
    it('answers 409 AI_NOT_CONFIGURED when the organization has no provider (no execution created)', async () => {
      for (const mode of ['sync', 'async']) {
        const res = await as(ctx, member, orgId)
          .post(`/api/v1/agents/${agent.id}/execute`)
          .send({ input: 'Hello', mode });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe(ErrorCode.AI_NOT_CONFIGURED);
      }
      expect(
        await ctx.prisma.client.agentExecution.count({ where: { organizationId: orgId } }),
      ).toBe(0);

      await as(ctx, owner, orgId)
        .post('/api/v1/ai/providers')
        .send({ provider: 'mock', name: 'Mock', defaultModel: 'mock-chat' });
    });

    let syncExecution: AgentExecutionDetail;

    it('runs synchronously with the mock provider and returns the finished detail', async () => {
      const res = await as(ctx, member, orgId)
        .post(`/api/v1/agents/${agent.id}/execute`)
        .send({ input: 'Say hi', mode: 'sync' });
      expect(res.status).toBe(200);
      syncExecution = res.body.data;
      expect(syncExecution).toMatchObject({
        agentId: agent.id,
        agent: { id: agent.id, name: 'Research agent' },
        trigger: 'manual',
        status: 'succeeded',
        input: 'Say hi',
        output: 'mock: Say hi',
        error: null,
        depth: 0,
        stepCount: 2,
        triggeredByUserId: member.user.id,
        parentExecutionId: null,
        estimatedCostUsd: null,
        children: [],
      });
      expect(syncExecution.rootExecutionId).toBe(syncExecution.id);
      expect(syncExecution.inputTokens).toBeGreaterThan(0);
      expect(syncExecution.startedAt).toBeTruthy();
      expect(syncExecution.finishedAt).toBeTruthy();
      expect(syncExecution.steps.map((s) => s.type)).toEqual(['llm_call', 'final']);
      expect(syncExecution.steps[0]).toMatchObject({
        index: 0,
        name: 'mock-chat',
        status: 'succeeded',
      });

      const log = await ctx.prisma.client.aiRequestLog.findMany({
        where: { executionId: syncExecution.id },
      });
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        agentId: agent.id,
        userId: member.user.id,
        status: 'success',
      });
      const usage = await ctx.prisma.client.usageRecord.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'asc' },
      });
      expect(usage.map((u) => u.metric)).toEqual(
        expect.arrayContaining(['agent_executions', 'ai_tokens']),
      );
      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: { organizationId: orgId, action: AuditAction.AGENT_EXECUTED, targetId: agent.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).toMatchObject({ executionId: syncExecution.id, mode: 'sync' });
    });

    let queued: AgentExecution;

    it('enqueues asynchronously by default (202) with an idempotent job on ai-tasks', async () => {
      const res = await as(ctx, member, orgId)
        .post(`/api/v1/agents/${agent.id}/execute`)
        .send({ input: { task: 'enrich', leadId: UNKNOWN_ID } });
      expect(res.status).toBe(202);
      queued = res.body.data;
      expect(queued).toMatchObject({
        status: 'queued',
        trigger: 'manual',
        input: { task: 'enrich', leadId: UNKNOWN_ID },
        startedAt: null,
      });
      expect(queued.rootExecutionId).toBe(queued.id);

      const jobs = await jobsOn(ctx, QueueName.AI_TASKS);
      const job = jobs.find((j) => j.id === `agent-exec-${queued.id}`);
      expect(job).toBeTruthy();
      expect(job!.data).toMatchObject({
        organizationId: orgId,
        kind: 'agent_execution',
        targetId: queued.id,
        requestedByUserId: member.user.id,
        idempotencyKey: `agent-exec-${queued.id}`,
      });
    });

    it('refuses to run disabled agents and to delete agents with active executions', async () => {
      await as(ctx, owner, orgId).patch(`/api/v1/agents/${agent.id}`).send({ isEnabled: false });
      const res = await as(ctx, member, orgId)
        .post(`/api/v1/agents/${agent.id}/execute`)
        .send({ input: 'x' });
      expect(res.status).toBe(409);
      await as(ctx, owner, orgId).patch(`/api/v1/agents/${agent.id}`).send({ isEnabled: true });

      const del = await as(ctx, owner, orgId).delete(`/api/v1/agents/${agent.id}`);
      expect(del.status).toBe(409);
      expect(del.body.error.details).toEqual({ activeExecutions: 1 });
    });

    it('lists executions (with filters) and returns the detail with ordered steps', async () => {
      const all = await as(ctx, member, orgId).get('/api/v1/agents/executions');
      expect(all.status).toBe(200);
      expect(all.body.meta.total).toBe(2);
      expect(all.body.data[0].id).toBe(queued.id); // newest first

      const succeeded = await as(ctx, member, orgId).get(
        '/api/v1/agents/executions?status=succeeded',
      );
      expect(succeeded.body.data.map((e: AgentExecution) => e.id)).toEqual([syncExecution.id]);
      const roots = await as(ctx, member, orgId).get(
        `/api/v1/agents/executions?rootOnly=true&agentId=${agent.id}`,
      );
      expect(roots.body.meta.total).toBe(2);

      const detail = await as(ctx, member, orgId).get(
        `/api/v1/agents/executions/${syncExecution.id}`,
      );
      expect(detail.status).toBe(200);
      expect(detail.body.data.steps.map((s: { index: number }) => s.index)).toEqual([0, 1]);
      expect(
        (await as(ctx, member, orgId).get(`/api/v1/agents/executions/${UNKNOWN_ID}`)).status,
      ).toBe(404);
    });

    it('cancels a queued execution immediately (and drops its job); finished ones → 409', async () => {
      const res = await as(ctx, member, orgId).post(
        `/api/v1/agents/executions/${queued.id}/cancel`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'cancelled', error: 'Cancelled by user' });
      expect(res.body.data.finishedAt).toBeTruthy();
      const jobs = await jobsOn(ctx, QueueName.AI_TASKS);
      expect(jobs.find((j) => j.id === `agent-exec-${queued.id}`)).toBeUndefined();

      const again = await as(ctx, member, orgId).post(
        `/api/v1/agents/executions/${queued.id}/cancel`,
      );
      expect(again.status).toBe(409);
      const finished = await as(ctx, member, orgId).post(
        `/api/v1/agents/executions/${syncExecution.id}/cancel`,
      );
      expect(finished.status).toBe(409);
    });

    it('requests cooperative cancellation for a running execution (Redis flag)', async () => {
      const running = await ctx.prisma.client.agentExecution.create({
        data: {
          organizationId: orgId,
          agentId: agent.id,
          status: 'running',
          trigger: 'api',
          input: 'long task',
          startedAt: new Date(),
          triggeredByUserId: owner.user.id,
        },
      });
      const res = await as(ctx, member, orgId).post(
        `/api/v1/agents/executions/${running.id}/cancel`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('running'); // the runner flips it when it notices the flag
      const { RedisService } = await import('../src/infrastructure/redis/redis.service');
      const redis = await ctx.app.get(RedisService).ensureConnected();
      expect(await redis.exists(`hta:exec:cancel:${running.id}`)).toBe(1);
      expect(await redis.ttl(`hta:exec:cancel:${running.id}`)).toBeGreaterThan(0);
      await redis.del(`hta:exec:cancel:${running.id}`);
      await ctx.prisma.client.agentExecution.delete({ where: { id: running.id } });
    });

    it('respects the plan token limit (402) and lets the usage summary attribute tokens to the agent', async () => {
      const summary = await as(ctx, owner, orgId).get('/api/v1/ai/usage/summary');
      expect(summary.body.data.byAgent).toEqual([
        expect.objectContaining({ agentId: agent.id, agentName: 'Research agent', requests: 1 }),
      ]);

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
      const res = await as(ctx, member, orgId)
        .post(`/api/v1/agents/${agent.id}/execute`)
        .send({ input: 'x' });
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe(ErrorCode.ENTITLEMENT_EXCEEDED);
    });
  });
});
