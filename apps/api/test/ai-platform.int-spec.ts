import {
  type AiModelInfo,
  type AiProviderConfig,
  type AiUsageSummary,
  AuditAction,
  ErrorCode,
  type PromptTemplate,
  type Role,
  type ToolDefinition,
} from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  expectNoSensitiveLeak,
  register,
  resetDatabase,
} from './setup/test-app';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const OPENAI_KEY = 'sk-test-0123456789abcdefghij-WXYZ';

describe('AI platform: providers, models, prompts, tools, usage', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let orgId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    orgId = (await createOrganization(ctx, owner, 'AI Co')).id;
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

  describe('provider configurations', () => {
    let mock: AiProviderConfig;
    let openai: AiProviderConfig;

    it('starts empty and lists nothing', async () => {
      const res = await as(ctx, owner, orgId).get('/api/v1/ai/providers');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('requires an API key for real providers', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/ai/providers')
        .send({ provider: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o-mini' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(res.body.error.details[0].path).toBe('apiKey');
    });

    it('creates a mock configuration; the first one becomes the default', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/ai/providers')
        .send({ provider: 'mock', name: 'Mock', defaultModel: 'mock-chat' });
      expect(res.status).toBe(201);
      mock = res.body.data;
      expect(mock).toMatchObject({
        organizationId: orgId,
        provider: 'mock',
        name: 'Mock',
        hasApiKey: false,
        keyLast4: null,
        isDefault: true,
        isEnabled: true,
        lastHealthStatus: 'unknown',
      });
      expect(res.body.data).not.toHaveProperty('encryptedApiKey');
      const audit = await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.AI_CONFIG_CREATED, targetId: mock.id },
      });
      expect(audit).toBe(1);
    });

    it('stores a real provider key encrypted and only ever exposes its last 4 characters', async () => {
      const res = await as(ctx, owner, orgId).post('/api/v1/ai/providers').send({
        provider: 'openai',
        name: 'OpenAI',
        apiKey: OPENAI_KEY,
        defaultModel: 'gpt-4o-mini',
        embeddingModel: 'text-embedding-3-small',
      });
      expect(res.status).toBe(201);
      openai = res.body.data;
      expect(openai).toMatchObject({ hasApiKey: true, keyLast4: 'WXYZ', isDefault: false });
      expectNoSensitiveLeak(res.body, [OPENAI_KEY, 'encryptedApiKey']);

      const row = await ctx.prisma.client.aiProviderConfig.findUniqueOrThrow({
        where: { id: openai.id },
      });
      expect(row.encryptedApiKey).toBeTruthy();
      expect(row.encryptedApiKey).not.toContain(OPENAI_KEY);
      expect(row.encryptedApiKey!.startsWith('v1.')).toBe(true);

      const list = await as(ctx, owner, orgId).get('/api/v1/ai/providers');
      expectNoSensitiveLeak(list.body, [OPENAI_KEY, 'encryptedApiKey']);
      expect(list.body.data).toHaveLength(2);
      expect(list.body.data[0].id).toBe(mock.id); // default first
    });

    it('refuses duplicate names (409)', async () => {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/ai/providers')
        .send({ provider: 'mock', name: 'Mock', defaultModel: 'mock-chat' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(ErrorCode.CONFLICT);
    });

    it('moves the default flag atomically and supports key rotation / clearing', async () => {
      const makeDefault = await as(ctx, owner, orgId)
        .patch(`/api/v1/ai/providers/${openai.id}`)
        .send({ isDefault: true });
      expect(makeDefault.status).toBe(200);
      expect(makeDefault.body.data.isDefault).toBe(true);
      const mockNow = await as(ctx, owner, orgId).get(`/api/v1/ai/providers/${mock.id}`);
      expect(mockNow.body.data.isDefault).toBe(false);

      const rotated = await as(ctx, owner, orgId)
        .patch(`/api/v1/ai/providers/${openai.id}`)
        .send({ apiKey: 'sk-rotated-000000000000-ABCD' });
      expect(rotated.status).toBe(200);
      expect(rotated.body.data.keyLast4).toBe('ABCD');

      const cleared = await as(ctx, owner, orgId)
        .patch(`/api/v1/ai/providers/${openai.id}`)
        .send({ clearApiKey: true });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data).toMatchObject({ hasApiKey: false, keyLast4: null });

      const both = await as(ctx, owner, orgId)
        .patch(`/api/v1/ai/providers/${openai.id}`)
        .send({ clearApiKey: true, apiKey: 'sk-another-000000000000-EFGH' });
      expect(both.status).toBe(400);

      // Back to the mock as default for the rest of the suite.
      const back = await as(ctx, owner, orgId)
        .patch(`/api/v1/ai/providers/${mock.id}`)
        .send({ isDefault: true });
      expect(back.body.data.isDefault).toBe(true);
    });

    it('health-checks a configuration and stores the outcome', async () => {
      const ok = await as(ctx, owner, orgId).post(`/api/v1/ai/providers/${mock.id}/health`);
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ status: 'ok', error: null });
      expect(typeof ok.body.data.latencyMs).toBe('number');
      const stored = await as(ctx, owner, orgId).get(`/api/v1/ai/providers/${mock.id}`);
      expect(stored.body.data.lastHealthStatus).toBe('ok');
      expect(stored.body.data.lastHealthCheckAt).toBeTruthy();

      // The OpenAI config has no key any more → health reports the configuration problem (no network call).
      const bad = await as(ctx, owner, orgId).post(`/api/v1/ai/providers/${openai.id}/health`);
      expect(bad.status).toBe(200);
      expect(bad.body.data.status).toBe('error');
      expect(bad.body.data.error).toMatch(/no API key/i);
    });

    it('lists the model catalogue, optionally per provider', async () => {
      const all = await as(ctx, owner, orgId).get('/api/v1/ai/models');
      expect(all.status).toBe(200);
      const models = all.body.data as AiModelInfo[];
      expect(models.some((m) => m.provider === 'anthropic')).toBe(true);
      expect(models.some((m) => m.id === 'mock-chat')).toBe(true);
      const mockOnly = await as(ctx, owner, orgId).get('/api/v1/ai/models?provider=mock');
      expect((mockOnly.body.data as AiModelInfo[]).every((m) => m.provider === 'mock')).toBe(true);
      const bad = await as(ctx, owner, orgId).get('/api/v1/ai/models?provider=nope');
      expect(bad.status).toBe(400);
    });

    it('deletes a configuration (409 while an agent references it)', async () => {
      const agent = await as(ctx, owner, orgId).post('/api/v1/agents').send({
        name: 'Pinned agent',
        instructions: 'Use the OpenAI config.',
        providerConfigId: openai.id,
      });
      expect(agent.status).toBe(201);
      const blocked = await as(ctx, owner, orgId).delete(`/api/v1/ai/providers/${openai.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.details).toEqual({ agents: 1 });

      expect(
        (await as(ctx, owner, orgId).delete(`/api/v1/agents/${agent.body.data.id}`)).status,
      ).toBe(204);
      const deleted = await as(ctx, owner, orgId).delete(`/api/v1/ai/providers/${openai.id}`);
      expect(deleted.status).toBe(204);
      expect((await as(ctx, owner, orgId).get(`/api/v1/ai/providers/${openai.id}`)).status).toBe(
        404,
      );
      expect((await as(ctx, owner, orgId).get(`/api/v1/ai/providers/${UNKNOWN_ID}`)).status).toBe(
        404,
      );
    });

    it('is managed by ai:config:* — the member role is denied', async () => {
      expect((await as(ctx, member, orgId).get('/api/v1/ai/providers')).status).toBe(403);
      expect(
        (
          await as(ctx, member, orgId)
            .post('/api/v1/ai/providers')
            .send({ provider: 'mock', name: 'M2', defaultModel: 'mock-chat' })
        ).status,
      ).toBe(403);
      expect((await as(ctx, member, orgId).get('/api/v1/ai/usage/summary')).status).toBe(403);
    });
  });

  describe('prompt templates', () => {
    let template: PromptTemplate;

    it('creates a template and extracts its variables', async () => {
      const res = await as(ctx, owner, orgId).post('/api/v1/ai/prompts').send({
        key: 'lead.followup',
        name: 'Lead follow-up',
        description: 'Email after a demo',
        content:
          'Hello {{ contact.firstName }}, thanks for meeting {{rep}} at {{org}}. {{rep}} will follow up.',
      });
      expect(res.status).toBe(201);
      template = res.body.data;
      expect(template).toMatchObject({
        key: 'lead.followup',
        variables: ['contact.firstName', 'rep', 'org'],
        version: 1,
        isSystem: false,
      });
      const audit = await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.PROMPT_TEMPLATE_CREATED },
      });
      expect(audit).toBe(1);
    });

    it('rejects duplicate keys and invalid keys', async () => {
      const dup = await as(ctx, owner, orgId)
        .post('/api/v1/ai/prompts')
        .send({ key: 'lead.followup', name: 'x', content: 'y' });
      expect(dup.status).toBe(409);
      const bad = await as(ctx, owner, orgId)
        .post('/api/v1/ai/prompts')
        .send({ key: 'Bad Key', name: 'x', content: 'y' });
      expect(bad.status).toBe(400);
    });

    it('bumps the version only when the content changes', async () => {
      const rename = await as(ctx, owner, orgId)
        .patch(`/api/v1/ai/prompts/${template.id}`)
        .send({ name: 'Lead follow-up (v2)' });
      expect(rename.body.data.version).toBe(1);
      const edit = await as(ctx, owner, orgId)
        .patch(`/api/v1/ai/prompts/${template.id}`)
        .send({ content: 'Hi {{name}}' });
      expect(edit.status).toBe(200);
      expect(edit.body.data).toMatchObject({ version: 2, variables: ['name'] });
    });

    it('renders non-strictly and reports missing variables', async () => {
      const res = await as(ctx, owner, orgId)
        .post(`/api/v1/ai/prompts/${template.id}/render`)
        .send({ variables: {} });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ rendered: 'Hi ', missing: ['name'] });
      const full = await as(ctx, owner, orgId)
        .post(`/api/v1/ai/prompts/${template.id}/render`)
        .send({ variables: { name: 'Dana', extra: 1 } });
      expect(full.body.data).toEqual({ rendered: 'Hi Dana', missing: [] });
    });

    it('lists, and protects system templates from deletion', async () => {
      const system = await ctx.prisma.client.promptTemplate.create({
        data: {
          organizationId: orgId,
          key: 'system.summary',
          name: 'System summary',
          content: 'Summarise {{text}}',
          variables: ['text'],
          isSystem: true,
        },
      });
      const list = await as(ctx, owner, orgId).get('/api/v1/ai/prompts');
      expect(list.status).toBe(200);
      expect(list.body.meta.total).toBe(2);
      expect(list.body.data[0].key).toBe('system.summary'); // system first

      const blocked = await as(ctx, owner, orgId).delete(`/api/v1/ai/prompts/${system.id}`);
      expect(blocked.status).toBe(409);
      const ok = await as(ctx, owner, orgId).delete(`/api/v1/ai/prompts/${template.id}`);
      expect(ok.status).toBe(204);
      expect((await as(ctx, owner, orgId).get(`/api/v1/ai/prompts/${template.id}`)).status).toBe(
        404,
      );
    });
  });

  describe('tool catalogue', () => {
    it('exposes registry tools plus the delegation descriptors to anyone with agents:read', async () => {
      const res = await as(ctx, member, orgId).get('/api/v1/ai/tools');
      expect(res.status).toBe(200);
      const tools = res.body.data as ToolDefinition[];
      const keys = tools.map((t) => t.key);
      expect(keys).toEqual(
        expect.arrayContaining(['time.now', 'crm.search_leads', 'knowledge.search']),
      );
      const delegate = tools.find((t) => t.key === 'agents.delegate');
      expect(delegate).toMatchObject({
        category: 'agents',
        riskLevel: 'read',
        requiredPermission: 'agents:execute',
      });
      expect(delegate!.inputSchema).toMatchObject({ type: 'object' });
      expect(tools.find((t) => t.key === 'agents.delegate_parallel')).toBeTruthy();
      expect(tools.find((t) => t.key === 'crm.create_lead')).toMatchObject({
        riskLevel: 'write',
        requiredPermission: 'leads:create',
      });
    });
  });

  describe('usage', () => {
    it('summarises the current month with the plan limit even before any request', async () => {
      const res = await as(ctx, owner, orgId).get('/api/v1/ai/usage/summary');
      expect(res.status).toBe(200);
      const summary = res.body.data as AiUsageSummary;
      expect(summary).toMatchObject({
        requests: 0,
        totalTokens: 0,
        errorCount: 0,
        byModel: [],
        byAgent: [],
        limit: { tokens: 100_000, used: 0 },
      });
      expect(new Date(summary.period.from).getUTCDate()).toBe(1);
    });

    it('validates the period and lists requests paginated', async () => {
      const bad = await as(ctx, owner, orgId).get(
        '/api/v1/ai/usage/summary?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z',
      );
      expect(bad.status).toBe(400);
      const list = await as(ctx, owner, orgId).get('/api/v1/ai/usage/requests?pageSize=5');
      expect(list.status).toBe(200);
      expect(list.body.meta).toMatchObject({ page: 1, pageSize: 5 });
    });
  });
});
