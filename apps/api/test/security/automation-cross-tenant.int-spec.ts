import { AuditAction, ErrorCode, type Role } from '@hilatech/contracts';
import { SecretBox, signInboundPayload } from '@hilatech/shared';
import request from 'supertest';

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
 * Tenant isolation for workflows, executions, webhooks (outbound + inbound) and integrations.
 * Org A users must never read, change, run, test or delete org B resources: with a forged
 * `x-organization-id` they get 403 NOT_A_MEMBER; when scoped to their own organization and guessing B's
 * ids they get 404 (never 403, so existence is not revealed). Secrets are never exposed in any response.
 */
describe('Security: automation cross-tenant isolation', () => {
  let ctx: TestContext;
  let userA: Actor;
  let userB: Actor;
  let memberA: Actor;
  let orgA: string;
  let orgB: string;
  let slugA: string;
  let slugB: string;
  let workflowB: string;
  let webhookWorkflowB: string;
  let executionB: string;
  let webhookB: string;
  let deliveryB: string;
  let endpointB: string;
  let endpointBSecret: string;
  let integrationB: string;
  let workflowA: string;
  let endpointA: string;
  let endpointASecret: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    userA = await register(ctx, { firstName: 'Alice', lastName: 'A' });
    memberA = await register(ctx, { firstName: 'Mel', lastName: 'Member' });
    userB = await register(ctx, { firstName: 'Bob', lastName: 'B' });
    const a = await createOrganization(ctx, userA, 'Org A');
    const b = await createOrganization(ctx, userB, 'Org B');
    orgA = a.id;
    orgB = b.id;
    slugA = a.slug;
    slugB = b.slug;
    const rolesA = (await as(ctx, userA, orgA).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: { organizationId: orgA, userId: memberA.user.id, roleId: rolesA.find((r) => r.key === 'member')!.id, status: 'active' },
    });

    // ---- Org B resources
    workflowB = (
      await as(ctx, userB, orgB)
        .post('/api/v1/workflows')
        .send({
          name: 'B secret flow',
          trigger: { type: 'manual' },
          steps: [{ id: 'v', type: 'set_variable', name: 'x', value: 'B-ONLY' }],
        })
    ).body.data.id;
    webhookWorkflowB = (
      await as(ctx, userB, orgB)
        .post('/api/v1/workflows')
        .send({
          name: 'B hook flow',
          trigger: { type: 'webhook' },
          steps: [{ id: 'v', type: 'set_variable', name: 'x', value: '1' }],
        })
    ).body.data.id;
    executionB = (await as(ctx, userB, orgB).post(`/api/v1/workflows/${workflowB}/run`).send({})).body.data.id;
    const wh = await as(ctx, userB, orgB)
      .post('/api/v1/webhooks')
      .send({ url: 'https://example.com/b-hook', events: ['lead.created'] });
    webhookB = wh.body.data.id;
    deliveryB = (await as(ctx, userB, orgB).post(`/api/v1/webhooks/${webhookB}/test`)).body.data.id;
    const ep = await as(ctx, userB, orgB)
      .post('/api/v1/webhook-endpoints')
      .send({ name: 'B in', slug: 'b-in', workflowId: webhookWorkflowB });
    endpointB = ep.body.data.id;
    endpointBSecret = ep.body.data.secret;
    integrationB = (
      await as(ctx, userB, orgB)
        .post('/api/v1/integrations')
        .send({
          name: 'B CRM',
          config: { kind: 'crm', provider: 'generic' },
          secrets: { apiKey: 'B-API-KEY-VALUE' },
        })
    ).body.data.id;

    // ---- Org A resources
    workflowA = (
      await as(ctx, userA, orgA)
        .post('/api/v1/workflows')
        .send({
          name: 'A hook flow',
          trigger: { type: 'webhook' },
          steps: [{ id: 'v', type: 'set_variable', name: 'x', value: '1' }],
        })
    ).body.data.id;
    const epA = await as(ctx, userA, orgA)
      .post('/api/v1/webhook-endpoints')
      .send({ name: 'A in', slug: 'a-in', workflowId: workflowA });
    endpointA = epA.body.data.id;
    endpointASecret = epA.body.data.secret;
  });

  afterAll(async () => {
    await ctx.close();
  });

  const SECRET_MARKERS = () => ['B-API-KEY-VALUE', endpointBSecret, 'encryptedSecret', 'encryptedSecrets', 'secretHash'];

  describe('a forged x-organization-id header is rejected (403 NOT_A_MEMBER) on every automation route', () => {
    const routes: Array<[string, (u: string) => string]> = [
      ['get', () => '/api/v1/workflows'],
      ['get', () => '/api/v1/workflow-executions'],
      ['get', () => '/api/v1/webhooks'],
      ['get', () => '/api/v1/webhook-endpoints'],
      ['get', () => '/api/v1/integrations'],
      ['get', () => '/api/v1/integrations/catalog'],
      ['get', () => '/api/v1/workflows/templates'],
    ];
    it.each(routes)('%s %#', async (method, url) => {
      const res = await (as(ctx, userA, orgB) as unknown as Record<string, (u: string) => request.Test>)[method]!(url(''));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
    });

    it('and records the attempt in the audit log of the attacker', async () => {
      const n = await ctx.prisma.client.auditLog.count({
        where: { action: AuditAction.TENANT_VIOLATION_ATTEMPT, actorUserId: userA.user.id },
      });
      expect(n).toBeGreaterThan(0);
    });
  });

  describe('guessing org B ids while scoped to org A yields 404', () => {
    it('workflows', async () => {
      const A = as(ctx, userA, orgA);
      for (const res of [
        await A.get(`/api/v1/workflows/${workflowB}`),
        await A.patch(`/api/v1/workflows/${workflowB}`).send({ name: 'pwned' }),
        await A.post(`/api/v1/workflows/${workflowB}/enable`),
        await A.post(`/api/v1/workflows/${workflowB}/disable`),
        await A.post(`/api/v1/workflows/${workflowB}/run`).send({}),
        await A.delete(`/api/v1/workflows/${workflowB}`),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
      }
      const row = await ctx.prisma.client.workflow.findUniqueOrThrow({ where: { id: workflowB } });
      expect(row.name).toBe('B secret flow');
      expect(await ctx.prisma.client.workflowExecution.count({ where: { workflowId: workflowB } })).toBe(1);
    });

    it('executions (detail 404, list never contains foreign rows even when filtering by B workflow id)', async () => {
      const A = as(ctx, userA, orgA);
      expect((await A.get(`/api/v1/workflow-executions/${executionB}`)).status).toBe(404);
      const list = await A.get(`/api/v1/workflow-executions?workflowId=${workflowB}`);
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([]);
      expect(list.body.meta.total).toBe(0);
      const all = await A.get('/api/v1/workflows');
      expect(JSON.stringify(all.body)).not.toContain('B secret flow');
      expect(JSON.stringify(all.body)).not.toContain('B-ONLY');
    });

    it('outbound webhooks and deliveries', async () => {
      const A = as(ctx, userA, orgA);
      for (const res of [
        await A.get(`/api/v1/webhooks/${webhookB}`),
        await A.patch(`/api/v1/webhooks/${webhookB}`).send({ url: 'https://evil.example.com/x' }),
        await A.post(`/api/v1/webhooks/${webhookB}/rotate-secret`),
        await A.post(`/api/v1/webhooks/${webhookB}/test`),
        await A.get(`/api/v1/webhooks/${webhookB}/deliveries`),
        await A.delete(`/api/v1/webhooks/${webhookB}`),
      ]) {
        expect(res.status).toBe(404);
      }
      const row = await ctx.prisma.client.webhook.findUniqueOrThrow({ where: { id: webhookB } });
      expect(row.url).toBe('https://example.com/b-hook');
      expect(await ctx.prisma.client.webhookDelivery.count({ where: { webhookId: webhookB } })).toBe(1);
      expect(deliveryB).toBeTruthy();
      const list = await A.get('/api/v1/webhooks');
      expect(list.body.data).toEqual([]);
    });

    it('inbound endpoints (including binding to or from a foreign workflow)', async () => {
      const A = as(ctx, userA, orgA);
      for (const res of [
        await A.get(`/api/v1/webhook-endpoints/${endpointB}`),
        await A.patch(`/api/v1/webhook-endpoints/${endpointB}`).send({ isEnabled: false }),
        await A.post(`/api/v1/webhook-endpoints/${endpointB}/rotate-secret`),
        await A.delete(`/api/v1/webhook-endpoints/${endpointB}`),
      ]) {
        expect(res.status).toBe(404);
      }
      // Binding A's endpoint to B's workflow must fail (workflow not found in org A).
      const bind = await A.patch(`/api/v1/webhook-endpoints/${endpointA}`).send({ workflowId: webhookWorkflowB });
      expect(bind.status).toBe(400);
      const create = await A.post('/api/v1/webhook-endpoints').send({ name: 'steal', slug: 'steal', workflowId: webhookWorkflowB });
      expect(create.status).toBe(400);
      const ep = await ctx.prisma.client.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointA } });
      expect(ep.workflowId).toBe(workflowA);
      expect((await A.get('/api/v1/webhook-endpoints')).body.data.map((e: { id: string }) => e.id)).toEqual([endpointA]);
    });

    it('integrations (and their credentials)', async () => {
      const A = as(ctx, userA, orgA);
      for (const res of [
        await A.get(`/api/v1/integrations/${integrationB}`),
        await A.patch(`/api/v1/integrations/${integrationB}`).send({ name: 'pwned' }),
        await A.post(`/api/v1/integrations/${integrationB}/test`),
        await A.delete(`/api/v1/integrations/${integrationB}`),
      ]) {
        expect(res.status).toBe(404);
      }
      expect((await A.get('/api/v1/integrations')).body.data).toEqual([]);
      expect((await A.get('/api/v1/integrations/status')).body.data.every((s: { total: number }) => s.total === 0)).toBe(true);
      expect(await ctx.prisma.client.integration.count({ where: { id: integrationB } })).toBe(1);
    });

    it('workflows referencing foreign resources cannot be activated', async () => {
      const agentB = await ctx.prisma.client.agent.create({
        data: { organizationId: orgB, name: 'B agent', instructions: 'secret instructions' },
      });
      const res = await as(ctx, userA, orgA)
        .post('/api/v1/workflows')
        .send({
          name: 'Uses B agent',
          trigger: { type: 'manual' },
          steps: [
            { id: 'a', type: 'agent_run', agentId: agentB.id, input: 'x', wait: true },
            { id: 'n', type: 'send_notification', to: { kind: 'user', userId: userB.user.id }, title: 't' },
          ],
        });
      expect(res.status).toBe(400);
      const msgs = (res.body.error.details.issues as Array<{ message: string }>).map((i) => i.message).join('|');
      expect(msgs).toContain('Agent not found in this organization');
      expect(msgs).toContain('not an active member');
      expect(JSON.stringify(res.body)).not.toContain('secret instructions');
    });
  });

  describe('inbound hooks: credentials are per organization and endpoint', () => {
    const body = JSON.stringify({ a: 1 });
    const hit = (slug: string, endpoint: string, headers: Record<string, string>) =>
      request(ctx.http).post(`/api/v1/hooks/${slug}/${endpoint}`).set('content-type', 'application/json').set(headers).send(body);

    it("org A's secret does not open org B's endpoint (and vice-versa) and creates no execution", async () => {
      const before = await ctx.prisma.client.workflowExecution.count({ where: { organizationId: orgB } });
      expect((await hit(slugB, 'b-in', { 'x-webhook-secret': endpointASecret })).status).toBe(401);
      expect((await hit(slugA, 'a-in', { 'x-webhook-secret': endpointBSecret })).status).toBe(401);
      expect((await hit(slugA, 'b-in', { 'x-webhook-secret': endpointBSecret })).status).toBe(401); // right secret, wrong org slug
      expect((await hit(slugB, 'a-in', { 'x-webhook-secret': endpointASecret })).status).toBe(401); // right secret, wrong org slug
      expect((await hit(slugB, 'b-in', { 'x-hilatech-signature': signInboundPayload(endpointASecret, body) })).status).toBe(401);
      expect(await ctx.prisma.client.workflowExecution.count({ where: { organizationId: orgB } })).toBe(before);
    });

    it('the right secret still works and creates the execution in the right organization only', async () => {
      const ok = await hit(slugB, 'b-in', { 'x-webhook-secret': endpointBSecret });
      expect(ok.status).toBe(202);
      const row = await ctx.prisma.client.workflowExecution.findUniqueOrThrow({ where: { id: ok.body.executionId } });
      expect(row.organizationId).toBe(orgB);
      expect(row.workflowId).toBe(webhookWorkflowB);
    });
  });

  describe('permissions inside one organization', () => {
    it('a plain member cannot create, change, run or delete automation resources, nor read secrets', async () => {
      const M = as(ctx, memberA, orgA);
      for (const res of [
        await M.post('/api/v1/workflows').send({ name: 'x', trigger: { type: 'manual' }, steps: [{ id: 'v', type: 'set_variable', name: 'x', value: '1' }] }),
        await M.post(`/api/v1/workflows/${workflowA}/run`).send({}),
        await M.post('/api/v1/webhooks').send({ url: 'https://example.com/x', events: ['lead.created'] }),
        await M.post('/api/v1/webhook-endpoints').send({ name: 'x', slug: 'xxx' }),
        await M.post(`/api/v1/webhook-endpoints/${endpointA}/rotate-secret`),
        await M.post('/api/v1/integrations').send({ name: 'x', config: { kind: 'rest', baseUrl: 'https://example.com' } }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
      }
      expect((await M.get('/api/v1/workflows')).status).toBe(200);
    });
  });

  it('no response ever contains secret material', async () => {
    for (const [user, org] of [[userA, orgA], [userB, orgB]] as const) {
      for (const url of [
        '/api/v1/workflows',
        '/api/v1/workflow-executions',
        '/api/v1/webhooks',
        '/api/v1/webhook-endpoints',
        '/api/v1/integrations',
        '/api/v1/integrations/status',
      ]) {
        const res = await as(ctx, user, org).get(url);
        const text = JSON.stringify(res.body);
        for (const marker of SECRET_MARKERS()) expect(text).not.toContain(marker);
      }
    }
  });

  it('stored ciphertext is bound to its organization (AAD): it only decrypts for the owning tenant', async () => {
    const box = new SecretBox(process.env.CREDENTIALS_ENCRYPTION_KEY!);
    const rowB = await ctx.prisma.client.integration.findUniqueOrThrow({ where: { id: integrationB } });
    expect(JSON.parse(box.decrypt(rowB.encryptedSecrets!, orgB))).toEqual({ apiKey: 'B-API-KEY-VALUE' });
    expect(() => box.decrypt(rowB.encryptedSecrets!, orgA)).toThrow();
    const hookB = await ctx.prisma.client.webhook.findUniqueOrThrow({ where: { id: webhookB } });
    expect(box.decrypt(hookB.encryptedSecret, orgB)).toMatch(/^whsec_/);
    expect(() => box.decrypt(hookB.encryptedSecret, orgA)).toThrow();
  });
});
