import { type Agent, ErrorCode, QueueName, type Role } from '@hilatech/contracts';
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
const CASE = {
  name: 'Greets the customer',
  input: 'Say hello to a new customer',
  checks: [{ type: 'contains', value: 'hello' }],
};

describe('Evaluations: datasets, cases, runs', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let outsider: Actor;
  let orgId: string;
  let otherOrgId: string;
  let agent: Agent;
  let datasetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    await ctx.app.get<Queue>(getQueueToken(QueueName.AI_TASKS)).obliterate({ force: true });
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    outsider = await register(ctx, { firstName: 'Otto', lastName: 'Outsider' });
    orgId = (await createOrganization(ctx, owner, 'Eval Co')).id;
    otherOrgId = (await createOrganization(ctx, outsider, 'Other Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
    await ctx.prisma.client.aiProviderConfig.create({
      data: {
        organizationId: orgId,
        provider: 'mock',
        name: 'Mock',
        defaultModel: 'mock-chat',
        isDefault: true,
        isEnabled: true,
      },
    });
    const created = await as(ctx, owner, orgId)
      .post('/api/v1/agents')
      .send({ name: 'Support agent', instructions: 'Answer politely.' });
    expect(created.status).toBe(201);
    agent = created.body.data as Agent;
  });

  afterAll(async () => {
    await ctx.app.get<Queue>(getQueueToken(QueueName.AI_TASKS)).obliterate({ force: true });
    await ctx.close();
  });

  it('creates a dataset, adds, edits and removes cases, and validates checks', async () => {
    const created = await as(ctx, owner, orgId)
      .post('/api/v1/evaluations/datasets')
      .send({ name: 'Support basics', description: 'Greeting and refunds' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: 'Support basics',
      caseCount: 0,
      lastRun: null,
    });
    datasetId = created.body.data.id;

    const added = await as(ctx, owner, orgId)
      .post(`/api/v1/evaluations/datasets/${datasetId}/cases`)
      .send(CASE);
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({ name: CASE.name, position: 0, checks: CASE.checks });

    const second = await as(ctx, owner, orgId)
      .post(`/api/v1/evaluations/datasets/${datasetId}/cases`)
      .send({ ...CASE, name: 'Temporary' });
    expect(second.body.data.position).toBe(1);

    const badRegex = await as(ctx, owner, orgId)
      .post(`/api/v1/evaluations/datasets/${datasetId}/cases`)
      .send({ ...CASE, checks: [{ type: 'regex', value: '(' }] });
    expect(badRegex.status).toBe(400);
    expect(badRegex.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    const noChecks = await as(ctx, owner, orgId)
      .post(`/api/v1/evaluations/datasets/${datasetId}/cases`)
      .send({ ...CASE, checks: [] });
    expect(noChecks.status).toBe(400);

    const patched = await as(ctx, owner, orgId)
      .patch(`/api/v1/evaluations/datasets/${datasetId}/cases/${added.body.data.id}`)
      .send({ checks: [{ type: 'not_contains', value: 'refund' }] });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({
      name: CASE.name,
      input: CASE.input,
      checks: [{ type: 'not_contains', value: 'refund' }],
    });

    const removed = await as(ctx, owner, orgId).delete(
      `/api/v1/evaluations/datasets/${datasetId}/cases/${second.body.data.id}`,
    );
    expect(removed.status).toBe(204);

    const detail = await as(ctx, member, orgId).get(`/api/v1/evaluations/datasets/${datasetId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.caseCount).toBe(1);
    expect(detail.body.data.cases).toHaveLength(1);
  });

  it('a member can read and run but not manage datasets', async () => {
    const list = await as(ctx, member, orgId).get('/api/v1/evaluations/datasets');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    const create = await as(ctx, member, orgId)
      .post('/api/v1/evaluations/datasets')
      .send({ name: 'Nope' });
    expect(create.status).toBe(403);
    const addCase = await as(ctx, member, orgId)
      .post(`/api/v1/evaluations/datasets/${datasetId}/cases`)
      .send(CASE);
    expect(addCase.status).toBe(403);
  });

  it('starts a run: 202, queued, one ai-tasks job; a second concurrent run is refused', async () => {
    const empty = await as(ctx, owner, orgId)
      .post('/api/v1/evaluations/datasets')
      .send({ name: 'Empty' });
    const noCases = await as(ctx, owner, orgId)
      .post(`/api/v1/evaluations/datasets/${empty.body.data.id}/runs`)
      .send({ agentId: agent.id });
    expect(noCases.status).toBe(409);

    const unknownAgent = await as(ctx, owner, orgId)
      .post(`/api/v1/evaluations/datasets/${datasetId}/runs`)
      .send({ agentId: UNKNOWN_ID });
    expect(unknownAgent.status).toBe(404);

    const started = await as(ctx, member, orgId)
      .post(`/api/v1/evaluations/datasets/${datasetId}/runs`)
      .send({ agentId: agent.id });
    expect(started.status).toBe(202);
    expect(started.body.data).toMatchObject({
      status: 'queued',
      totalCases: 1,
      passed: 0,
      passRate: null,
      agentName: 'Support agent',
      datasetName: 'Support basics',
    });
    const runId = started.body.data.id as string;

    const jobs = (await jobsOn(ctx, QueueName.AI_TASKS)).filter(
      (j) => j.data.kind === 'evaluation_run',
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toMatchObject({ organizationId: orgId, targetId: runId });

    const duplicate = await as(ctx, owner, orgId)
      .post(`/api/v1/evaluations/datasets/${datasetId}/runs`)
      .send({ agentId: agent.id });
    expect(duplicate.status).toBe(409);

    const runs = await as(ctx, member, orgId).get(
      `/api/v1/evaluations/runs?datasetId=${datasetId}`,
    );
    expect(runs.status).toBe(200);
    expect(runs.body.data.map((r: { id: string }) => r.id)).toEqual([runId]);

    const cancelled = await as(ctx, member, orgId).post(`/api/v1/evaluations/runs/${runId}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('cancelled');
    const again = await as(ctx, member, orgId).post(`/api/v1/evaluations/runs/${runId}/cancel`);
    expect(again.status).toBe(409);

    const detail = await as(ctx, member, orgId).get(`/api/v1/evaluations/runs/${runId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.results).toEqual([]);

    const dataset = await as(ctx, owner, orgId).get(`/api/v1/evaluations/datasets/${datasetId}`);
    expect(dataset.body.data.lastRun).toMatchObject({ id: runId, status: 'cancelled' });
  });

  it('another organization cannot see, change, run or delete anything', async () => {
    const o = as(ctx, outsider, otherOrgId);
    expect((await o.get('/api/v1/evaluations/datasets')).body.data).toEqual([]);
    expect((await o.get(`/api/v1/evaluations/datasets/${datasetId}`)).status).toBe(404);
    expect(
      (await o.patch(`/api/v1/evaluations/datasets/${datasetId}`).send({ name: 'Hacked' })).status,
    ).toBe(404);
    expect(
      (await o.post(`/api/v1/evaluations/datasets/${datasetId}/cases`).send(CASE)).status,
    ).toBe(404);
    expect(
      (await o.post(`/api/v1/evaluations/datasets/${datasetId}/runs`).send({ agentId: agent.id }))
        .status,
    ).toBe(404);
    expect((await o.delete(`/api/v1/evaluations/datasets/${datasetId}`)).status).toBe(404);
    const run = await ctx.prisma.client.evaluationRun.findFirstOrThrow({
      where: { organizationId: orgId },
    });
    expect((await o.get(`/api/v1/evaluations/runs/${run.id}`)).status).toBe(404);
    expect((await o.post(`/api/v1/evaluations/runs/${run.id}/cancel`)).status).toBe(404);
    expect((await o.get('/api/v1/evaluations/runs')).body.data).toEqual([]);

    // A run cannot use an agent of another organization either.
    const foreign = await o.post('/api/v1/evaluations/datasets').send({ name: 'Theirs' });
    await o.post(`/api/v1/evaluations/datasets/${foreign.body.data.id}/cases`).send(CASE);
    const crossAgent = await o
      .post(`/api/v1/evaluations/datasets/${foreign.body.data.id}/runs`)
      .send({ agentId: agent.id });
    expect(crossAgent.status).toBe(404);
  });

  it('deleting a dataset removes its cases, runs and results', async () => {
    const res = await as(ctx, owner, orgId).delete(`/api/v1/evaluations/datasets/${datasetId}`);
    expect(res.status).toBe(204);
    expect(await ctx.prisma.client.evaluationCase.count({ where: { datasetId } })).toBe(0);
    expect(await ctx.prisma.client.evaluationRun.count({ where: { datasetId } })).toBe(0);
  });
});
