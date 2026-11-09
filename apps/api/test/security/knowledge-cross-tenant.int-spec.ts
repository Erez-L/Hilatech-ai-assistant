import {
  DocumentIngestor,
  EmbeddingService,
  PgVectorStore,
  ToolExecutor,
  ToolRegistry,
} from '@hilatech/ai-engine';
import { type Document, ErrorCode, type KnowledgeBase } from '@hilatech/contracts';
import { type StorageDriver } from '@hilatech/storage';

import { STORAGE_DRIVER } from '../../src/infrastructure/storage/storage.module';
import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  register,
  resetDatabase,
} from '../setup/test-app';

const SHARED_TEXT =
  'Confidential pricing sheet. The enterprise discount is forty percent for annual contracts.';
const A_ONLY_TEXT = 'Project Falcon launch codename is only known inside organization A.';

/**
 * Tenant isolation for the knowledge slice: org B must never see, search, download, change or delete
 * org A knowledge bases, documents, chunks or files — neither through a forged organization header
 * (403 NOT_A_MEMBER) nor by guessing ids while scoped to its own organization (404, never 403) — and
 * retrieval (API and the knowledge.search tool) is org-scoped even when both tenants hold identical text.
 */
describe('Security: knowledge cross-tenant isolation', () => {
  let ctx: TestContext;
  let userA: Actor;
  let userB: Actor;
  let orgA: string;
  let orgB: string;
  let baseA: KnowledgeBase;
  let baseB: KnowledgeBase;
  let docA: Document;
  let docA2: Document;
  let docB: Document;
  let storage: StorageDriver;
  let keyA: string;

  const attach = (actor: Actor, org: string, baseId: string, text: string, name: string) =>
    as(ctx, actor, org)
      .post(`/api/v1/knowledge/bases/${baseId}/documents`)
      .attach('file', Buffer.from(text), { filename: name, contentType: 'text/plain' });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    userA = await register(ctx, { firstName: 'Alice', lastName: 'A' });
    userB = await register(ctx, { firstName: 'Bob', lastName: 'B' });
    orgA = (await createOrganization(ctx, userA, 'Org A')).id;
    orgB = (await createOrganization(ctx, userB, 'Org B')).id;
    for (const [actor, org] of [
      [userA, orgA],
      [userB, orgB],
    ] as const) {
      await as(ctx, actor, org)
        .post('/api/v1/ai/providers')
        .send({ provider: 'mock', name: 'Mock', defaultModel: 'mock-chat' });
    }
    baseA = (
      await as(ctx, userA, orgA).post('/api/v1/knowledge/bases').send({ name: 'Shared name' })
    ).body.data;
    baseB = (
      await as(ctx, userB, orgB).post('/api/v1/knowledge/bases').send({ name: 'Shared name' })
    ).body.data;
    docA = (await attach(userA, orgA, baseA.id, SHARED_TEXT, 'pricing-a.txt')).body.data;
    docA2 = (await attach(userA, orgA, baseA.id, A_ONLY_TEXT, 'falcon.txt')).body.data;
    docB = (await attach(userB, orgB, baseB.id, SHARED_TEXT, 'pricing-b.txt')).body.data;

    storage = ctx.app.get<StorageDriver>(STORAGE_DRIVER);
    const ingestor = new DocumentIngestor({
      prisma: ctx.prisma.client,
      storage,
      embeddings: ctx.app.get(EmbeddingService),
      store: ctx.app.get(PgVectorStore),
    });
    for (const [doc, org] of [
      [docA, orgA],
      [docA2, orgA],
      [docB, orgB],
    ] as const) {
      await ingestor.process({
        organizationId: org,
        documentId: doc.id,
        knowledgeBaseId: doc.knowledgeBaseId,
        attempt: 1,
        maxAttempts: 5,
      });
    }
    keyA = (await ctx.prisma.client.document.findUniqueOrThrow({ where: { id: docA.id } }))
      .storageKey;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('keeps files under the owning organization prefix', async () => {
    expect(keyA.startsWith(`org/${orgA}/documents/`)).toBe(true);
    const keyB = (await ctx.prisma.client.document.findUniqueOrThrow({ where: { id: docB.id } }))
      .storageKey;
    expect(keyB.startsWith(`org/${orgB}/documents/`)).toBe(true);
    expect(keyA).not.toBe(keyB);
  });

  it('refuses a forged organization header outright (403 NOT_A_MEMBER)', async () => {
    const forged = as(ctx, userB, orgA);
    for (const res of [
      await forged.get('/api/v1/knowledge/bases'),
      await forged.get(`/api/v1/knowledge/bases/${baseA.id}`),
      await forged.get(`/api/v1/knowledge/documents/${docA.id}`),
      await forged.get(`/api/v1/knowledge/documents/${docA.id}/download`),
      await forged.post('/api/v1/knowledge/search').send({ query: 'pricing' }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
    }
  });

  it('answers 404 for org A bases, documents, chunks and files addressed from org B', async () => {
    const b = as(ctx, userB, orgB);
    const attempts = [
      b.get(`/api/v1/knowledge/bases/${baseA.id}`),
      b.patch(`/api/v1/knowledge/bases/${baseA.id}`).send({ name: 'hijack' }),
      b.delete(`/api/v1/knowledge/bases/${baseA.id}`),
      b.get(`/api/v1/knowledge/bases/${baseA.id}/documents`),
      b
        .post(`/api/v1/knowledge/bases/${baseA.id}/documents`)
        .attach('file', Buffer.from('planted'), { filename: 'x.txt', contentType: 'text/plain' }),
      b.get(`/api/v1/knowledge/documents/${docA.id}`),
      b.get(`/api/v1/knowledge/documents/${docA.id}/chunks`),
      b.get(`/api/v1/knowledge/documents/${docA.id}/download`),
      b.post(`/api/v1/knowledge/documents/${docA.id}/reprocess`),
      b.delete(`/api/v1/knowledge/documents/${docA.id}`),
    ];
    for (const attempt of attempts) {
      const res = await attempt;
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
      expect(JSON.stringify(res.body)).not.toContain(SHARED_TEXT.slice(0, 20));
    }
    // Nothing of A changed.
    const a = as(ctx, userA, orgA);
    expect((await a.get(`/api/v1/knowledge/documents/${docA.id}`)).body.data.status).toBe('ready');
    expect((await a.get(`/api/v1/knowledge/bases/${baseA.id}`)).body.data.name).toBe('Shared name');
    expect(await storage.head(keyA)).not.toBeNull();
    expect(await ctx.prisma.client.document.count({ where: { knowledgeBaseId: baseA.id } })).toBe(
      2,
    );
  });

  it('never lists org A resources for org B', async () => {
    const bases = (await as(ctx, userB, orgB).get('/api/v1/knowledge/bases')).body
      .data as KnowledgeBase[];
    expect(bases.map((x) => x.id)).toEqual([baseB.id]);
    const docs = (await as(ctx, userB, orgB).get(`/api/v1/knowledge/bases/${baseB.id}/documents`))
      .body.data as Document[];
    expect(docs.map((x) => x.id)).toEqual([docB.id]);
  });

  it('search from org B returns only org B chunks, even with identical content', async () => {
    const res = await as(ctx, userB, orgB)
      .post('/api/v1/knowledge/search')
      .send({ query: 'enterprise discount annual contracts', limit: 20, minScore: 0 });
    expect(res.status).toBe(200);
    const hits = res.body.data.hits as Array<{
      documentId: string;
      knowledgeBaseId: string;
      content: string;
    }>;
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.documentId).toBe(docB.id);
      expect(hit.knowledgeBaseId).toBe(baseB.id);
    }
    const secret = await as(ctx, userB, orgB)
      .post('/api/v1/knowledge/search')
      .send({ query: 'Project Falcon launch codename', limit: 20, minScore: 0 });
    expect(JSON.stringify(secret.body)).not.toContain('Falcon');
    expect(
      secret.body.data.hits.every((h: { documentId: string }) => h.documentId === docB.id),
    ).toBe(true);

    // And the symmetric direction: A sees only A.
    const forA = await as(ctx, userA, orgA)
      .post('/api/v1/knowledge/search')
      .send({ query: 'enterprise discount annual contracts', limit: 20, minScore: 0 });
    const aDocs = new Set(forA.body.data.hits.map((h: { documentId: string }) => h.documentId));
    expect(aDocs.has(docB.id)).toBe(false);
    expect(aDocs.has(docA.id)).toBe(true);
  });

  it('refuses explicit org A knowledge base ids in a search from org B (404)', async () => {
    const res = await as(ctx, userB, orgB)
      .post('/api/v1/knowledge/search')
      .send({ query: 'pricing', knowledgeBaseIds: [baseA.id] });
    expect(res.status).toBe(404);
    const mixed = await as(ctx, userB, orgB)
      .post('/api/v1/knowledge/search')
      .send({ query: 'pricing', knowledgeBaseIds: [baseB.id, baseA.id] });
    expect(mixed.status).toBe(404);
  });

  it('the vector store and the knowledge.search tool are organization-scoped', async () => {
    const store = ctx.app.get(PgVectorStore);
    const embedding = (
      await ctx.app.get(EmbeddingService).embedTexts(orgB, ['Project Falcon launch codename'])
    ).vectors[0]!;
    // Even naming A's base explicitly, org B's scope returns nothing from A.
    const viaStore = await store.search({
      organizationId: orgB,
      embedding,
      knowledgeBaseIds: [baseA.id],
      limit: 20,
      minScore: -1,
    });
    expect(viaStore).toEqual([]);

    const executor = new ToolExecutor(ctx.app.get(ToolRegistry));
    const outcome = await executor.execute(
      {
        organizationId: orgB,
        userId: userB.user.id,
        agentId: null,
        executionId: null,
        prisma: ctx.prisma.client,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        signal: new AbortController().signal,
        now: () => new Date(),
      },
      { allowedTools: ['knowledge.search'], permissions: ['knowledge:read'], allowWrite: false },
      {
        id: 't',
        name: 'knowledge.search',
        input: { query: 'Project Falcon launch codename', limit: 10 },
      },
    );
    expect(outcome.status).toBe('ok');
    expect(JSON.stringify(outcome.result.data)).not.toContain('Falcon');
  });
});
