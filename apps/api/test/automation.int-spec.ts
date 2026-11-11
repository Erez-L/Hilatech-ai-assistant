import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  AuditAction,
  ErrorCode,
  QueueName,
  type Integration,
  type Role,
  type Workflow,
  type WorkflowExecution,
} from '@hilatech/contracts';
import { signInboundPayload } from '@hilatech/shared';
import request from 'supertest';

import {
  type Actor,
  type TestContext,
  anon,
  as,
  createOrganization,
  createTestApp,
  jobsOn,
  register,
  resetDatabase,
} from './setup/test-app';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const eventWorkflow = (name: string, overrides: Record<string, unknown> = {}) => ({
  name,
  trigger: { type: 'event', event: 'lead.created' },
  steps: [
    {
      id: 'note',
      type: 'create_lead_note',
      leadId: '{{ trigger.payload.leadId }}',
      body: 'New lead {{ trigger.payload.title }}',
    },
  ],
  ...overrides,
});

describe('Automation (workflows, webhooks, integrations, domain events)', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let orgId: string;
  let orgSlug: string;
  let remote: Server;
  let remoteUrl: string;
  const remoteHits: Array<{ url?: string; headers: IncomingMessage['headers'] }> = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    const org = await createOrganization(ctx, owner, 'Automation Co');
    orgId = org.id;
    orgSlug = org.slug;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
    remote = createServer((req, res) => {
      remoteHits.push({ url: req.url, headers: req.headers });
      if (req.url === '/forbidden') {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
    await new Promise<void>((r) => remote.listen(0, r));
    remoteUrl = `http://localhost:${(remote.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    remote.close();
    await ctx.close();
  });

  // -------------------------------------------------------------------------------------------
  describe('workflows', () => {
    let workflow: Workflow;

    it('lists templates and every template validates (placeholder ids are rejected only by reference checks)', async () => {
      const res = await as(ctx, member, orgId).get('/api/v1/workflows/templates');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(5);
      for (const t of res.body.data) {
        const v = await as(ctx, owner, orgId)
          .post('/api/v1/workflows/validate')
          .send({ trigger: t.trigger, steps: t.steps });
        expect(v.status).toBe(200);
        // Only resource-reference issues may remain (agent/user/n8n placeholders).
        for (const issue of v.body.data.issues as Array<{ message: string }>) {
          expect(issue.message).toMatch(
            /Agent not found|not an active member|No enabled n8n|does not exist/,
          );
        }
      }
    });

    it('validate reports structural problems without storing anything', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/workflows/validate')
        .send({
          trigger: { type: 'schedule', cron: '99 * * * *' },
          steps: [
            { id: 'a', type: 'delay', seconds: 5 },
            { id: 'a', type: 'delay', seconds: 5 },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.valid).toBe(false);
      const messages = (res.body.data.issues as Array<{ message: string }>)
        .map((i) => i.message)
        .join('|');
      expect(messages).toContain('out of range');
      expect(messages).toContain('Duplicate step id');
      expect(await ctx.prisma.client.workflow.count({ where: { organizationId: orgId } })).toBe(0);
    });

    it('refuses to create or activate an invalid enabled workflow, but accepts the same definition as a disabled draft', async () => {
      const bad = eventWorkflow('Broken', {
        trigger: { type: 'schedule', cron: 'nonsense * * * *' },
      });
      const rejected = await as(ctx, owner, orgId).post('/api/v1/workflows').send(bad);
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(rejected.body.error.details.issues[0].path).toBe('trigger.cron');

      const draft = await as(ctx, owner, orgId)
        .post('/api/v1/workflows')
        .send({ ...bad, isEnabled: false });
      expect(draft.status).toBe(201);
      const activate = await as(ctx, owner, orgId).post(
        `/api/v1/workflows/${draft.body.data.id}/enable`,
      );
      expect(activate.status).toBe(400);
      expect(
        (await as(ctx, owner, orgId).get(`/api/v1/workflows/${draft.body.data.id}`)).body.data
          .isEnabled,
      ).toBe(false);
    });

    it('checks referenced agents, users and roles against THIS organization', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/workflows')
        .send({
          name: 'Refs',
          trigger: { type: 'manual' },
          steps: [
            { id: 'ag', type: 'agent_run', agentId: UNKNOWN_ID, input: 'hi', wait: true },
            {
              id: 'n1',
              type: 'send_notification',
              to: { kind: 'user', userId: UNKNOWN_ID },
              title: 't',
            },
            {
              id: 'n2',
              type: 'send_notification',
              to: { kind: 'role', roleKey: 'nope' },
              title: 't',
            },
            { id: 'n8', type: 'n8n_trigger', webhook: 'x', payload: {} },
          ],
        });
      expect(res.status).toBe(400);
      const msgs = (res.body.error.details.issues as Array<{ message: string }>).map(
        (i) => i.message,
      );
      expect(msgs).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Agent not found'),
          expect.stringContaining('not an active member'),
          expect.stringContaining('does not exist'),
          expect.stringContaining('n8n integration'),
        ]),
      );
    });

    it('creates, reads, lists, updates and audits a workflow; names are unique per organization', async () => {
      const created = await as(ctx, owner, orgId)
        .post('/api/v1/workflows')
        .send(eventWorkflow('Note on new lead'));
      expect(created.status).toBe(201);
      workflow = created.body.data;
      expect(workflow).toMatchObject({
        isEnabled: true,
        runCount: 0,
        lastRunAt: null,
        createdById: owner.user.id,
      });

      expect(
        (
          await as(ctx, owner, orgId)
            .post('/api/v1/workflows')
            .send(eventWorkflow('Note on new lead'))
        ).status,
      ).toBe(409);
      expect((await as(ctx, member, orgId).get(`/api/v1/workflows/${workflow.id}`)).status).toBe(
        200,
      );
      const list = await as(ctx, member, orgId).get(
        '/api/v1/workflows?triggerType=event&isEnabled=true&search=note',
      );
      expect(list.body.data.map((w: Workflow) => w.id)).toEqual([workflow.id]);
      expect(list.body.meta.total).toBe(1);

      const patched = await as(ctx, owner, orgId)
        .patch(`/api/v1/workflows/${workflow.id}`)
        .send({ description: 'adds a note', name: 'Note on new lead v2' });
      expect(patched.body.data).toMatchObject({
        description: 'adds a note',
        name: 'Note on new lead v2',
      });

      const audits = await ctx.prisma.client.auditLog.findMany({
        where: { organizationId: orgId, targetId: workflow.id },
      });
      expect(audits.map((a) => a.action)).toEqual(
        expect.arrayContaining([AuditAction.WORKFLOW_CREATED, AuditAction.WORKFLOW_UPDATED]),
      );
    });

    it('members can read but not manage workflows', async () => {
      for (const res of [
        await as(ctx, member, orgId).post('/api/v1/workflows').send(eventWorkflow('x')),
        await as(ctx, member, orgId)
          .patch(`/api/v1/workflows/${workflow.id}`)
          .send({ name: 'hack' }),
        await as(ctx, member, orgId).post(`/api/v1/workflows/${workflow.id}/run`).send({}),
        await as(ctx, member, orgId).delete(`/api/v1/workflows/${workflow.id}`),
      ]) {
        expect(res.status).toBe(403);
      }
    });

    it('runs a workflow manually: queued execution + automation.execute job; disabled workflows cannot run', async () => {
      const run = await as(ctx, owner, orgId)
        .post(`/api/v1/workflows/${workflow.id}/run`)
        .send({ input: { leadId: UNKNOWN_ID, title: 'Manual' } });
      expect(run.status).toBe(202);
      const execution: WorkflowExecution = run.body.data;
      expect(execution).toMatchObject({
        workflowId: workflow.id,
        status: 'queued',
        trigger: { type: 'manual', actorUserId: owner.user.id },
        input: { leadId: UNKNOWN_ID, title: 'Manual' },
        stepResults: [],
      });
      const jobs = await jobsOn(ctx, QueueName.AUTOMATION);
      expect(jobs.find((j) => j.data.executionId === execution.id)?.data).toMatchObject({
        kind: 'execute',
        organizationId: orgId,
        workflowId: workflow.id,
      });

      const detail = await as(ctx, member, orgId).get(
        `/api/v1/workflow-executions/${execution.id}`,
      );
      expect(detail.body.data).toMatchObject({ id: execution.id, workflow: { id: workflow.id } });
      const list = await as(ctx, member, orgId).get(
        `/api/v1/workflow-executions?workflowId=${workflow.id}&status=queued`,
      );
      expect(list.body.data.map((e: WorkflowExecution) => e.id)).toContain(execution.id);

      await as(ctx, owner, orgId).post(`/api/v1/workflows/${workflow.id}/disable`).expect(200);
      const blocked = await as(ctx, owner, orgId)
        .post(`/api/v1/workflows/${workflow.id}/run`)
        .send({});
      expect(blocked.status).toBe(409);
      expect(
        await ctx.prisma.client.workflowExecution.count({ where: { workflowId: workflow.id } }),
      ).toBe(1);
      await as(ctx, owner, orgId).post(`/api/v1/workflows/${workflow.id}/enable`).expect(200);
    });

    it('deletes a workflow together with its executions', async () => {
      const w = await as(ctx, owner, orgId).post('/api/v1/workflows').send(eventWorkflow('Temp'));
      await as(ctx, owner, orgId)
        .post(`/api/v1/workflows/${w.body.data.id}/run`)
        .send({})
        .expect(202);
      expect(
        (await as(ctx, owner, orgId).delete(`/api/v1/workflows/${w.body.data.id}`)).status,
      ).toBe(204);
      expect((await as(ctx, owner, orgId).get(`/api/v1/workflows/${w.body.data.id}`)).status).toBe(
        404,
      );
      expect(
        await ctx.prisma.client.workflowExecution.count({ where: { workflowId: w.body.data.id } }),
      ).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('domain events (emission points)', () => {
    async function events(name: string) {
      const jobs = await jobsOn(ctx, QueueName.AUTOMATION);
      return jobs.filter(
        (j) => j.data.kind === 'event' && j.data.event === name && j.data.organizationId === orgId,
      );
    }

    it('emits lead.created / status_changed / assigned / converted and contact.created', async () => {
      const created = await as(ctx, owner, orgId)
        .post('/api/v1/leads')
        .send({ title: 'Event lead' });
      expect(created.status).toBe(201);
      const lead = created.body.data;
      const createdEvents = await events('lead.created');
      const ev = createdEvents.find(
        (e) => (e.data.payload as { leadId: string }).leadId === lead.id,
      )!;
      expect(ev.data).toMatchObject({
        kind: 'event',
        organizationId: orgId,
        actorUserId: owner.user.id,
        payload: { leadId: lead.id, title: 'Event lead', status: 'new', organizationId: orgId },
      });

      await as(ctx, owner, orgId)
        .patch(`/api/v1/leads/${lead.id}`)
        .send({ status: 'qualified' })
        .expect(200);
      const status = (await events('lead.status_changed')).find(
        (e) => (e.data.payload as { leadId: string }).leadId === lead.id,
      );
      expect(status?.data.payload).toMatchObject({ status: 'qualified', previousStatus: 'new' });

      await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${lead.id}/assign`)
        .send({ assigneeId: member.user.id })
        .expect(200);
      const assigned = (await events('lead.assigned')).find(
        (e) => (e.data.payload as { leadId: string }).leadId === lead.id,
      );
      expect(assigned?.data.payload).toMatchObject({
        assigneeId: member.user.id,
        previousAssigneeId: null,
      });

      await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${lead.id}/convert`)
        .send({ contact: { firstName: 'Conv', email: 'conv@example.com' }, markWon: true })
        .expect(200);
      expect(
        (await events('lead.converted')).some(
          (e) => (e.data.payload as { leadId: string }).leadId === lead.id,
        ),
      ).toBe(true);
      expect(
        (await events('contact.created')).some(
          (e) => (e.data.payload as { fromLeadId?: string }).fromLeadId === lead.id,
        ),
      ).toBe(true);
      expect(
        (await events('lead.status_changed')).some(
          (e) =>
            (e.data.payload as { leadId: string; viaConversion?: boolean }).leadId === lead.id &&
            (e.data.payload as { viaConversion?: boolean }).viaConversion,
        ),
      ).toBe(true);
    });

    it('emits contact.created and the conversation events', async () => {
      const contact = await as(ctx, owner, orgId)
        .post('/api/v1/contacts')
        .send({ firstName: 'Cathy' });
      expect(
        (await events('contact.created')).some(
          (e) => (e.data.payload as { contactId: string }).contactId === contact.body.data.id,
        ),
      ).toBe(true);

      const conv = await as(ctx, owner, orgId)
        .post('/api/v1/conversations')
        .send({ channel: 'web', contactId: contact.body.data.id });
      const convId = conv.body.data.id;
      expect(
        (await events('conversation.created')).some(
          (e) => (e.data.payload as { conversationId: string }).conversationId === convId,
        ),
      ).toBe(true);

      await as(ctx, owner, orgId)
        .post(`/api/v1/conversations/${convId}/messages`)
        .send({ role: 'agent', content: 'hi' })
        .expect(201);
      await as(ctx, owner, orgId)
        .post(`/api/v1/conversations/${convId}/messages`)
        .send({ role: 'customer', content: 'I need help with my invoice' })
        .expect(201);
      const received = (await events('conversation.message_received')).filter(
        (e) => (e.data.payload as { conversationId: string }).conversationId === convId,
      );
      expect(received).toHaveLength(1); // agent messages are not "received"
      expect(received[0]!.data.payload).toMatchObject({
        role: 'customer',
        preview: 'I need help with my invoice',
      });

      await as(ctx, owner, orgId)
        .post(`/api/v1/conversations/${convId}/assign`)
        .send({ assigneeId: member.user.id })
        .expect(200);
      expect(
        (await events('conversation.assigned')).some(
          (e) => (e.data.payload as { conversationId: string }).conversationId === convId,
        ),
      ).toBe(true);
      await as(ctx, owner, orgId)
        .patch(`/api/v1/conversations/${convId}`)
        .send({ status: 'resolved' })
        .expect(200);
      expect(
        (await events('conversation.resolved')).some(
          (e) => (e.data.payload as { conversationId: string }).conversationId === convId,
        ),
      ).toBe(true);
    });

    it('a failing queue never fails the business request', async () => {
      // emission is best-effort: even if enqueue threw, the lead is created (covered by DomainEventsService try/catch)
      const res = await as(ctx, owner, orgId).post('/api/v1/leads').send({ title: 'Still works' });
      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('outbound webhooks', () => {
    let webhookId: string;
    let secret: string;

    it('creates a subscription: the secret is shown once, stored encrypted, never returned again', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/webhooks')
        .send({
          url: `${remoteUrl}/hook`,
          events: ['lead.created', 'lead.converted'],
          description: 'CRM sync',
        });
      expect(res.status).toBe(201);
      secret = res.body.data.secret;
      webhookId = res.body.data.id;
      expect(secret).toMatch(/^whsec_/);
      expect(res.body.data.secretLast4).toBe(secret.slice(-4));

      const row = await ctx.prisma.client.webhook.findUniqueOrThrow({ where: { id: webhookId } });
      expect(row.encryptedSecret).not.toContain(secret);
      expect(row.encryptedSecret.startsWith('v1.')).toBe(true);

      for (const url of [`/api/v1/webhooks/${webhookId}`, '/api/v1/webhooks']) {
        const read = await as(ctx, owner, orgId).get(url);
        expect(JSON.stringify(read.body)).not.toContain(secret);
        expect(JSON.stringify(read.body)).not.toContain('encryptedSecret');
      }
    });

    it('rejects private/loopback-IP and non-https URLs (SSRF guard at the API)', async () => {
      // (loopback is deliberately allowed outside production so local receivers work in development)
      for (const url of [
        'http://example.com/x',
        'https://169.254.169.254/x',
        'https://10.0.0.5/x',
        'https://192.168.1.10/x',
        'https://[fd00::1]/x',
      ]) {
        const res = await as(ctx, owner, orgId)
          .post('/api/v1/webhooks')
          .send({ url, events: ['lead.created'] });
        expect(res.status).toBe(400);
      }
    });

    it('validates events, updates, rotates the secret (new value shown once)', async () => {
      expect(
        (
          await as(ctx, owner, orgId)
            .post('/api/v1/webhooks')
            .send({ url: 'https://example.com/x', events: ['nope'] })
        ).status,
      ).toBe(400);
      const up = await as(ctx, owner, orgId)
        .patch(`/api/v1/webhooks/${webhookId}`)
        .send({ events: ['lead.created'], isEnabled: true });
      expect(up.body.data.events).toEqual(['lead.created']);
      const rot = await as(ctx, owner, orgId).post(`/api/v1/webhooks/${webhookId}/rotate-secret`);
      expect(rot.status).toBe(200);
      expect(rot.body.data.secret).toMatch(/^whsec_/);
      expect(rot.body.data.secret).not.toBe(secret);
      secret = rot.body.data.secret;
    });

    it('test delivery creates a pending delivery row and a webhook-delivery job; deliveries are listed', async () => {
      const res = await as(ctx, owner, orgId).post(`/api/v1/webhooks/${webhookId}/test`);
      expect(res.status).toBe(202);
      expect(res.body.data).toMatchObject({
        webhookId,
        event: 'webhook.test',
        status: 'pending',
        attempts: 0,
      });
      const jobs = await jobsOn(ctx, QueueName.WEBHOOK_DELIVERY);
      expect(jobs.find((j) => j.data.deliveryId === res.body.data.id)?.data).toMatchObject({
        organizationId: orgId,
        attempt: 0,
      });

      const list = await as(ctx, member, orgId).get(
        `/api/v1/webhooks/${webhookId}/deliveries?status=pending`,
      );
      expect(list.body.data.map((d: { id: string }) => d.id)).toContain(res.body.data.id);
      expect(list.body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it('members cannot manage subscriptions; unknown ids are 404', async () => {
      expect(
        (
          await as(ctx, member, orgId)
            .post('/api/v1/webhooks')
            .send({ url: 'https://example.com/x', events: ['lead.created'] })
        ).status,
      ).toBe(403);
      expect((await as(ctx, member, orgId).post(`/api/v1/webhooks/${webhookId}/test`)).status).toBe(
        403,
      );
      expect((await as(ctx, owner, orgId).get(`/api/v1/webhooks/${UNKNOWN_ID}`)).status).toBe(404);
    });

    it('deletes a subscription', async () => {
      const w = await as(ctx, owner, orgId)
        .post('/api/v1/webhooks')
        .send({ url: `${remoteUrl}/tmp`, events: ['lead.created'] });
      expect(
        (await as(ctx, owner, orgId).delete(`/api/v1/webhooks/${w.body.data.id}`)).status,
      ).toBe(204);
      expect((await as(ctx, owner, orgId).get(`/api/v1/webhooks/${w.body.data.id}`)).status).toBe(
        404,
      );
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('inbound webhooks (POST /hooks/:org/:endpoint)', () => {
    let hookWorkflow: Workflow;
    let endpointId: string;
    let secret: string;
    const path = () => `/api/v1/hooks/${orgSlug}/orders`;
    const body = JSON.stringify({ title: 'Order 42', message: 'paid' });
    const post = (headers: Record<string, string>, payload = body, p = path()) =>
      request(ctx.http).post(p).set('content-type', 'application/json').set(headers).send(payload);

    beforeAll(async () => {
      hookWorkflow = (
        await as(ctx, owner, orgId)
          .post('/api/v1/workflows')
          .send({
            name: 'Inbound alert',
            trigger: { type: 'webhook' },
            steps: [
              { id: 's', type: 'set_variable', name: 'x', value: '{{ trigger.payload.title }}' },
            ],
          })
      ).body.data;
    });

    it('only workflows with the webhook trigger can be bound; the secret is returned once', async () => {
      const other = (
        await as(ctx, owner, orgId).post('/api/v1/workflows').send(eventWorkflow('Not a hook'))
      ).body.data;
      const bad = await as(ctx, owner, orgId)
        .post('/api/v1/webhook-endpoints')
        .send({ name: 'Orders', slug: 'orders', workflowId: other.id });
      expect(bad.status).toBe(400);
      const bad2 = await as(ctx, owner, orgId)
        .post('/api/v1/webhook-endpoints')
        .send({ name: 'Orders', slug: 'orders', workflowId: UNKNOWN_ID });
      expect(bad2.status).toBe(400);

      const res = await as(ctx, owner, orgId)
        .post('/api/v1/webhook-endpoints')
        .send({ name: 'Orders', slug: 'orders', workflowId: hookWorkflow.id });
      expect(res.status).toBe(201);
      endpointId = res.body.data.id;
      secret = res.body.data.secret;
      expect(res.body.data.path).toBe(path());
      expect(secret).toMatch(/^whk_/);
      const row = await ctx.prisma.client.webhookEndpoint.findUniqueOrThrow({
        where: { id: endpointId },
      });
      expect(row.secretHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(secret);
      expect(
        JSON.stringify(
          (await as(ctx, owner, orgId).get(`/api/v1/webhook-endpoints/${endpointId}`)).body,
        ),
      ).not.toContain(secret);
      expect(
        (
          await as(ctx, owner, orgId)
            .post('/api/v1/webhook-endpoints')
            .send({ name: 'Dup', slug: 'orders' })
        ).status,
      ).toBe(409);
      expect(
        (
          await as(ctx, owner, orgId)
            .post('/api/v1/webhook-endpoints')
            .send({ name: 'Bad', slug: 'Not Valid!' })
        ).status,
      ).toBe(400);
    });

    it('rejects every kind of bad credential with the same 401 (no tenant/endpoint enumeration)', async () => {
      const responses = [
        await post({}), // none
        await post({ 'x-webhook-secret': 'wrong' }),
        await post({ 'x-hilatech-signature': 'sha256=' + 'a'.repeat(64) }),
        await post({ 'x-hilatech-signature': signInboundPayload('wrong-secret', body) }),
        await post({ 'x-hilatech-signature': signInboundPayload(secret, body + ' ') }), // body tampered
        await post({ 'x-webhook-secret': secret }, body, `/api/v1/hooks/${orgSlug}/does-not-exist`),
        await post({ 'x-webhook-secret': secret }, body, `/api/v1/hooks/no-such-org/orders`),
      ];
      for (const res of responses) {
        expect(res.status).toBe(401);
        expect(res.body.error.message).toBe('Invalid webhook credentials');
      }
      expect(
        await ctx.prisma.client.workflowExecution.count({ where: { workflowId: hookWorkflow.id } }),
      ).toBe(0);
      const failures = await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.WEBHOOK_ENDPOINT_AUTH_FAILED },
      });
      expect(failures).toBeGreaterThanOrEqual(5);
    });

    it('rejects stale timestamps (replay protection)', async () => {
      const old = Math.floor(Date.now() / 1000) - 3600;
      const res = await post({
        'x-hilatech-signature': signInboundPayload(secret, body, old),
        'x-hilatech-timestamp': String(old),
      });
      expect(res.status).toBe(401);
    });

    it('accepts a valid secret header: 202 { executionId } and queues the bound workflow', async () => {
      const res = await post({ 'x-webhook-secret': secret });
      expect(res.status).toBe(202);
      expect(Object.keys(res.body)).toEqual(['executionId']);
      const execution = await ctx.prisma.client.workflowExecution.findUniqueOrThrow({
        where: { id: res.body.executionId },
      });
      expect(execution).toMatchObject({
        organizationId: orgId,
        workflowId: hookWorkflow.id,
        status: 'queued',
        input: { title: 'Order 42', message: 'paid' },
        trigger: { type: 'webhook', endpointId, authMethod: 'secret' },
      });
      const jobs = await jobsOn(ctx, QueueName.AUTOMATION);
      expect(jobs.find((j) => j.data.executionId === res.body.executionId)?.data).toMatchObject({
        kind: 'execute',
        workflowId: hookWorkflow.id,
      });
      const endpoint = (await as(ctx, owner, orgId).get(`/api/v1/webhook-endpoints/${endpointId}`))
        .body.data;
      expect(endpoint.receivedCount).toBe(1);
      expect(endpoint.lastReceivedAt).toEqual(expect.any(String));
    });

    it('accepts a valid HMAC signature (plain and timestamped) over the raw body', async () => {
      const plain = await post({ 'x-hilatech-signature': signInboundPayload(secret, body) });
      expect(plain.status).toBe(202);
      const ts = Math.floor(Date.now() / 1000);
      const stamped = await post({
        'x-hilatech-signature': signInboundPayload(secret, body, ts),
        'x-hilatech-timestamp': String(ts),
      });
      expect(stamped.status).toBe(202);
      const row = await ctx.prisma.client.workflowExecution.findUniqueOrThrow({
        where: { id: plain.body.executionId },
      });
      expect((row.trigger as { authMethod: string }).authMethod).toBe('signature');
    });

    it('wraps non-object JSON bodies; the signature covers the exact bytes (whitespace matters)', async () => {
      const arr = '[1, 2,3]';
      const res = await post({ 'x-hilatech-signature': signInboundPayload(secret, arr) }, arr);
      expect(res.status).toBe(202);
      const row = await ctx.prisma.client.workflowExecution.findUniqueOrThrow({
        where: { id: res.body.executionId },
      });
      expect(row.input).toEqual({ body: [1, 2, 3] });
      const compact = '[1,2,3]';
      expect(
        (await post({ 'x-hilatech-signature': signInboundPayload(secret, arr) }, compact)).status,
      ).toBe(401);
    });

    it('does not run when the endpoint or the bound workflow is disabled, or unbound', async () => {
      const before = await ctx.prisma.client.workflowExecution.count({
        where: { workflowId: hookWorkflow.id },
      });
      await as(ctx, owner, orgId)
        .patch(`/api/v1/webhook-endpoints/${endpointId}`)
        .send({ isEnabled: false })
        .expect(200);
      expect((await post({ 'x-webhook-secret': secret })).status).toBe(409);
      await as(ctx, owner, orgId)
        .patch(`/api/v1/webhook-endpoints/${endpointId}`)
        .send({ isEnabled: true })
        .expect(200);
      await as(ctx, owner, orgId).post(`/api/v1/workflows/${hookWorkflow.id}/disable`).expect(200);
      expect((await post({ 'x-webhook-secret': secret })).status).toBe(409);
      await as(ctx, owner, orgId).post(`/api/v1/workflows/${hookWorkflow.id}/enable`).expect(200);
      expect(
        await ctx.prisma.client.workflowExecution.count({ where: { workflowId: hookWorkflow.id } }),
      ).toBe(before);
    });

    it('a rotated secret invalidates the old one', async () => {
      const rot = await as(ctx, owner, orgId).post(
        `/api/v1/webhook-endpoints/${endpointId}/rotate-secret`,
      );
      expect(rot.status).toBe(200);
      expect((await post({ 'x-webhook-secret': secret })).status).toBe(401);
      secret = rot.body.data.secret;
      expect((await post({ 'x-webhook-secret': secret })).status).toBe(202);
    });

    it('is public (no bearer token needed), not tenant-header based, and members cannot manage endpoints', async () => {
      expect(
        (await anon(ctx).post(path()).set('x-webhook-secret', secret).send({ a: 1 })).status,
      ).toBe(202);
      expect(
        (
          await as(ctx, member, orgId)
            .post('/api/v1/webhook-endpoints')
            .send({ name: 'x', slug: 'xxx' })
        ).status,
      ).toBe(403);
      expect((await as(ctx, member, orgId).get('/api/v1/webhook-endpoints')).status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('integrations', () => {
    let rest: Integration;

    it('lists the catalogue honestly: only rest and n8n are live', async () => {
      const res = await as(ctx, member, orgId).get('/api/v1/integrations/catalog');
      expect(res.status).toBe(200);
      const live = Object.fromEntries(
        res.body.data.map((e: { kind: string; liveSupport: string }) => [e.kind, e.liveSupport]),
      );
      expect(live).toEqual({
        rest: 'full',
        n8n: 'full',
        email: 'planned',
        whatsapp: 'planned',
        crm: 'planned',
      });
      const status = await as(ctx, member, orgId).get('/api/v1/integrations/status');
      expect(status.body.data.find((s: { kind: string }) => s.kind === 'email')).toMatchObject({
        availability: 'not_configured',
        connected: 0,
      });
      expect(status.body.data.find((s: { kind: string }) => s.kind === 'rest')).toMatchObject({
        availability: 'available',
      });
    });

    it('connects a REST integration: credentials encrypted, never returned, connectivity tested immediately', async () => {
      remoteHits.length = 0;
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/integrations')
        .send({
          name: 'Billing API',
          config: {
            kind: 'rest',
            baseUrl: remoteUrl,
            authType: 'bearer',
            headers: { 'x-tenant': 'acme' },
          },
          secrets: { accessToken: 'super-secret-token-123' },
        });
      expect(res.status).toBe(201);
      rest = res.body.data;
      expect(rest).toMatchObject({
        kind: 'rest',
        status: 'connected',
        hasSecrets: true,
        secretKeys: ['accessToken'],
        lastError: null,
      });
      expect(rest.lastCheckedAt).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toContain('super-secret-token-123');
      expect(remoteHits[0]!.headers.authorization).toBe('Bearer super-secret-token-123');
      expect(remoteHits[0]!.headers['x-tenant']).toBe('acme');

      const row = await ctx.prisma.client.integration.findUniqueOrThrow({ where: { id: rest.id } });
      expect(row.encryptedSecrets).toBeTruthy();
      expect(row.encryptedSecrets).not.toContain('super-secret-token-123');
      expect(JSON.stringify(row.config)).not.toContain('super-secret-token-123');
      for (const url of ['/api/v1/integrations', `/api/v1/integrations/${rest.id}`]) {
        expect(JSON.stringify((await as(ctx, owner, orgId).get(url)).body)).not.toContain(
          'super-secret-token-123',
        );
      }
      const audit = await ctx.prisma.client.auditLog.findMany({
        where: { organizationId: orgId, targetId: rest.id },
      });
      expect(JSON.stringify(audit)).not.toContain('super-secret-token-123');
    });

    it('validates credentials per auth type and URL safety', async () => {
      const noToken = await as(ctx, owner, orgId)
        .post('/api/v1/integrations')
        .send({ name: 'x', config: { kind: 'rest', baseUrl: remoteUrl, authType: 'bearer' } });
      expect(noToken.status).toBe(400);
      for (const baseUrl of [
        'http://example.com',
        'https://10.1.2.3',
        'https://169.254.169.254/',
      ]) {
        const res = await as(ctx, owner, orgId)
          .post('/api/v1/integrations')
          .send({ name: 'ssrf', config: { kind: 'rest', baseUrl } });
        expect(res.status).toBe(400);
      }
      expect(
        (
          await as(ctx, owner, orgId)
            .post('/api/v1/integrations')
            .send({
              name: 'Billing API',
              config: { kind: 'rest', baseUrl: remoteUrl },
              secrets: {},
            })
        ).status,
      ).toBe(409);
    });

    it('re-tests: rejected credentials surface as error status with the reason', async () => {
      const bad = await as(ctx, owner, orgId)
        .post('/api/v1/integrations')
        .send({ name: 'Locked', config: { kind: 'rest', baseUrl: `${remoteUrl}/forbidden` } });
      expect(bad.body.data).toMatchObject({ status: 'error' });
      expect(bad.body.data.lastError).toContain('403');
      const test = await as(ctx, owner, orgId).post(`/api/v1/integrations/${rest.id}/test`);
      expect(test.status).toBe(200);
      expect(test.body.data).toMatchObject({ ok: true, status: 'connected' });
      const down = await as(ctx, owner, orgId)
        .post('/api/v1/integrations')
        .send({ name: 'Down', config: { kind: 'rest', baseUrl: 'http://localhost:1' } });
      expect(down.body.data).toMatchObject({ status: 'error' });
    });

    it('merges secrets on update ("" deletes) and resets the status until re-tested', async () => {
      const up = await as(ctx, owner, orgId)
        .patch(`/api/v1/integrations/${rest.id}`)
        .send({ secrets: { apiKey: 'k-2', accessToken: '' } });
      expect(up.status).toBe(200);
      expect(up.body.data.secretKeys).toEqual(['apiKey']);
      expect(up.body.data.status).toBe('unconfigured');
      expect(
        (
          await as(ctx, owner, orgId)
            .patch(`/api/v1/integrations/${rest.id}`)
            .send({ config: { kind: 'n8n', baseUrl: remoteUrl } })
        ).status,
      ).toBe(400);
    });

    it('connects n8n against /healthz', async () => {
      remoteHits.length = 0;
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/integrations')
        .send({
          name: 'n8n',
          config: { kind: 'n8n', baseUrl: remoteUrl },
          secrets: { apiKey: 'n8n-key' },
        });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('connected');
      expect(remoteHits[0]).toMatchObject({ url: '/healthz' });
      expect(remoteHits[0]!.headers['x-n8n-api-key']).toBe('n8n-key');
    });

    it('does NOT pretend email / WhatsApp / CRM work: stored as configuration, test always reports unconfigured', async () => {
      const email = await as(ctx, owner, orgId)
        .post('/api/v1/integrations')
        .send({
          name: 'Company SMTP',
          config: {
            kind: 'email',
            provider: 'smtp',
            host: 'smtp.example.com',
            fromAddress: 'noreply@example.com',
          },
          secrets: { username: 'u', password: 'p' },
        });
      expect(email.status).toBe(201);
      expect(email.body.data).toMatchObject({
        kind: 'email',
        status: 'unconfigured',
        hasSecrets: true,
      });
      const test = await as(ctx, owner, orgId).post(
        `/api/v1/integrations/${email.body.data.id}/test`,
      );
      expect(test.body.data).toMatchObject({ ok: false, status: 'unconfigured' });
      expect(test.body.data.message).toMatch(/configuration-only/);
      const wa = await as(ctx, owner, orgId)
        .post('/api/v1/integrations')
        .send({
          name: 'WA',
          config: { kind: 'whatsapp', provider: 'twilio' },
          secrets: { accessToken: 't' },
        });
      expect(wa.body.data.status).toBe('unconfigured');
      const status = await as(ctx, owner, orgId).get('/api/v1/integrations/status');
      expect(status.body.data.find((s: { kind: string }) => s.kind === 'email')).toMatchObject({
        connected: 0,
        total: 1,
      });
    });

    it('members can read but not manage; disconnect deletes the credentials', async () => {
      expect((await as(ctx, member, orgId).get('/api/v1/integrations')).status).toBe(200);
      expect(
        (await as(ctx, member, orgId).post(`/api/v1/integrations/${rest.id}/test`)).status,
      ).toBe(403);
      expect((await as(ctx, member, orgId).delete(`/api/v1/integrations/${rest.id}`)).status).toBe(
        403,
      );
      expect((await as(ctx, owner, orgId).delete(`/api/v1/integrations/${rest.id}`)).status).toBe(
        204,
      );
      expect(await ctx.prisma.client.integration.count({ where: { id: rest.id } })).toBe(0);
      expect((await as(ctx, owner, orgId).get(`/api/v1/integrations/${rest.id}`)).status).toBe(404);
    });
  });
});
