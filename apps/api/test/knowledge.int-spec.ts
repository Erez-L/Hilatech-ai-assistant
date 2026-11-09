import {
  DocumentIngestor,
  EmbeddingService,
  PgVectorStore,
  ToolExecutor,
  ToolRegistry,
} from '@hilatech/ai-engine';
import {
  AuditAction,
  type Document,
  ErrorCode,
  type KnowledgeBase,
  type KnowledgeSearchResult,
  QueueName,
  type Role,
} from '@hilatech/contracts';
import { type StorageDriver } from '@hilatech/storage';
import request from 'supertest';

import { STORAGE_DRIVER } from '../src/infrastructure/storage/storage.module';
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

const REFUND =
  'Refund policy\n\nCustomers may return products within thirty days of purchase for a full refund. ' +
  'Returns must include the original receipt.';
const KITCHEN =
  'Office kitchen\n\nThe office kitchen is cleaned every Friday evening by the facilities team.';

describe('Knowledge: bases, documents, processing and search', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let orgId: string;
  let providerId: string;
  let ingestor: DocumentIngestor;
  let storage: StorageDriver;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Kay', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    orgId = (await createOrganization(ctx, owner, 'Knowledge Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
    providerId = (
      await as(ctx, owner, orgId)
        .post('/api/v1/ai/providers')
        .send({ provider: 'mock', name: 'Mock', defaultModel: 'mock-chat' })
    ).body.data.id;
    storage = ctx.app.get<StorageDriver>(STORAGE_DRIVER);
    ingestor = new DocumentIngestor({
      prisma: ctx.prisma.client,
      storage,
      embeddings: ctx.app.get(EmbeddingService),
      store: ctx.app.get(PgVectorStore),
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const api = () => as(ctx, owner, orgId);
  const createBase = async (name: string, extra: Record<string, unknown> = {}) => {
    const res = await api()
      .post('/api/v1/knowledge/bases')
      .send({ name, ...extra });
    expect(res.status).toBe(201);
    return res.body.data as KnowledgeBase;
  };
  const upload = (
    baseId: string,
    content: Buffer | string,
    filename: string,
    contentType = 'text/plain',
    fields: Record<string, string> = {},
  ) => {
    const req = api()
      .post(`/api/v1/knowledge/bases/${baseId}/documents`)
      .attach('file', Buffer.isBuffer(content) ? content : Buffer.from(content), {
        filename,
        contentType,
      });
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    return req;
  };
  const runWorker = async (doc: Pick<Document, 'id' | 'knowledgeBaseId'>) =>
    ingestor.process({
      organizationId: orgId,
      documentId: doc.id,
      knowledgeBaseId: doc.knowledgeBaseId,
      attempt: 1,
      maxAttempts: 5,
    });
  const getDoc = async (id: string) =>
    (await api().get(`/api/v1/knowledge/documents/${id}`)).body.data as Document;
  const search = (body: Record<string, unknown>) =>
    api().post('/api/v1/knowledge/search').send(body);

  let base: KnowledgeBase;
  let refundDoc: Document;
  let kitchenDoc: Document;

  describe('knowledge bases', () => {
    it('creates a base pinned to the embedding-capable provider, lists and updates it', async () => {
      base = await createBase('Company policies', { description: 'HR and finance' });
      expect(base).toMatchObject({
        organizationId: orgId,
        name: 'Company policies',
        embeddingProviderConfigId: providerId,
        documentCount: 0,
        chunkCount: 0,
        createdById: owner.user.id,
      });
      const list = await api().get('/api/v1/knowledge/bases?search=polic');
      expect(list.status).toBe(200);
      expect(list.body.data.map((b: KnowledgeBase) => b.id)).toEqual([base.id]);
      expect(list.body.meta.total).toBe(1);

      const renamed = await api()
        .patch(`/api/v1/knowledge/bases/${base.id}`)
        .send({ name: 'Policies' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.name).toBe('Policies');
      base = renamed.body.data;
    });

    it('rejects duplicate names, unknown providers and bad models', async () => {
      const dup = await api().post('/api/v1/knowledge/bases').send({ name: 'Policies' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe(ErrorCode.CONFLICT);
      const unknownProvider = await api()
        .post('/api/v1/knowledge/bases')
        .send({ name: 'X', embeddingProviderConfigId: '00000000-0000-4000-8000-000000000000' });
      expect(unknownProvider.status).toBe(404);
      const badModel = await api()
        .post('/api/v1/knowledge/bases')
        .send({ name: 'Y', embeddingProviderConfigId: providerId, embeddingModel: 'mock-chat' });
      expect(badModel.status).toBe(400);
      expect((await api().post('/api/v1/knowledge/bases').send({ name: '' })).status).toBe(400);
    });

    it('enforces knowledge:read / knowledge:manage', async () => {
      const m = as(ctx, member, orgId);
      expect((await m.get('/api/v1/knowledge/bases')).status).toBe(200);
      expect((await m.get(`/api/v1/knowledge/bases/${base.id}`)).status).toBe(200);
      for (const res of [
        await m.post('/api/v1/knowledge/bases').send({ name: 'Nope' }),
        await m.patch(`/api/v1/knowledge/bases/${base.id}`).send({ name: 'Nope' }),
        await m.delete(`/api/v1/knowledge/bases/${base.id}`),
        await m
          .post(`/api/v1/knowledge/bases/${base.id}/documents`)
          .attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' }),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
      }
      const noAuth = await request(ctx.http).get('/api/v1/knowledge/bases');
      expect(noAuth.status).toBe(401);
    });
  });

  describe('upload → process → search', () => {
    it('stores the file under a tenant-scoped key, creates Document(uploaded) and enqueues a job', async () => {
      const res = await upload(base.id, REFUND, 'refund-policy.txt', 'text/plain', {
        title: 'Refund Policy',
      });
      expect(res.status).toBe(201);
      refundDoc = res.body.data;
      expect(refundDoc).toMatchObject({
        organizationId: orgId,
        knowledgeBaseId: base.id,
        title: 'Refund Policy',
        fileName: 'refund-policy.txt',
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(REFUND),
        status: 'uploaded',
        error: null,
        chunkCount: 0,
        uploadedById: owner.user.id,
      });
      expect(JSON.stringify(refundDoc)).not.toContain('storageKey');

      const row = await ctx.prisma.client.document.findUniqueOrThrow({
        where: { id: refundDoc.id },
      });
      expect(row.storageKey).toMatch(
        new RegExp(`^org/${orgId}/documents/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.txt$`),
      );
      expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect((await storage.get(row.storageKey)).toString()).toBe(REFUND);

      const jobs = await jobsOn(ctx, QueueName.DOCUMENT_PROCESSING);
      const job = jobs.find((j) => j.data.documentId === refundDoc.id);
      expect(job?.data).toMatchObject({
        organizationId: orgId,
        knowledgeBaseId: base.id,
        idempotencyKey: `doc-process-${refundDoc.id}`,
      });
      expect((await api().get(`/api/v1/knowledge/bases/${base.id}`)).body.data.documentCount).toBe(
        1,
      );
    });

    it('defaults the title to the file name without extension (Hebrew names survive)', async () => {
      const res = await upload(base.id, KITCHEN, 'מטבח-המשרד.md', 'text/markdown');
      expect(res.status).toBe(201);
      kitchenDoc = res.body.data;
      expect(kitchenDoc.fileName).toBe('מטבח-המשרד.md');
      expect(kitchenDoc.title).toBe('מטבח-המשרד');
      expect(kitchenDoc.mimeType).toBe('text/markdown');
    });

    it('does not return unprocessed documents from search', async () => {
      const res = await search({ query: 'refund policy' });
      expect(res.status).toBe(200);
      expect(res.body.data.hits).toEqual([]);
    });

    it('processes documents (worker pipeline) and marks them ready with chunks and vectors', async () => {
      const result = await runWorker(refundDoc);
      expect(result).toMatchObject({ status: 'ready', embeddingModel: 'mock-embedding' });
      await runWorker(kitchenDoc);
      const ready = await getDoc(refundDoc.id);
      expect(ready.status).toBe('ready');
      expect(ready.error).toBeNull();
      expect(ready.chunkCount).toBeGreaterThan(0);
      expect(ready.processedAt).not.toBeNull();
      expect(ready.metadata).toMatchObject({ embedding: { model: 'mock-embedding' } });

      const chunks = await api().get(`/api/v1/knowledge/documents/${refundDoc.id}/chunks`);
      expect(chunks.status).toBe(200);
      expect(chunks.body.data[0]).toMatchObject({ index: 0, documentId: refundDoc.id });
      expect(chunks.body.data[0].content).toContain('Refund policy');
      expect(chunks.body.data[0].metadata).toHaveProperty('offset', 0);

      const [embedded] = await ctx.prisma.client.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n FROM "DocumentChunk"
        WHERE "documentId" = ${refundDoc.id}::uuid AND "embedding" IS NOT NULL`;
      expect(Number(embedded!.n)).toBe(ready.chunkCount);
      const kb = (await api().get(`/api/v1/knowledge/bases/${base.id}`)).body.data as KnowledgeBase;
      expect(kb.documentCount).toBe(2);
      expect(kb.chunkCount).toBeGreaterThanOrEqual(2);
    });

    it('is idempotent: re-running a ready document changes nothing', async () => {
      const before = await getDoc(refundDoc.id);
      expect(await runWorker(refundDoc)).toEqual({ status: 'skipped', reason: 'already_ready' });
      const after = await getDoc(refundDoc.id);
      expect(after.chunkCount).toBe(before.chunkCount);
      expect(after.processedAt).toBe(before.processedAt);
    });

    it('finds the relevant passage with source attribution and a score', async () => {
      const res = await search({ query: 'what is the refund policy for returns?', limit: 3 });
      expect(res.status).toBe(200);
      const result = res.body.data as KnowledgeSearchResult;
      expect(result.model).toBe('mock-embedding');
      expect(result.tookMs).toBeGreaterThanOrEqual(0);
      expect(result.hits.length).toBeGreaterThan(0);
      const top = result.hits[0]!;
      expect(top).toMatchObject({
        documentId: refundDoc.id,
        knowledgeBaseId: base.id,
        documentTitle: 'Refund Policy',
        index: 0,
      });
      expect(top.content).toContain('thirty days');
      expect(top.score).toBeGreaterThan(0.2);
      expect(top.score).toBeLessThanOrEqual(1);
      for (let i = 1; i < result.hits.length; i += 1) {
        expect(result.hits[i - 1]!.score).toBeGreaterThanOrEqual(result.hits[i]!.score);
      }
      const kitchen = await search({ query: 'when is the kitchen cleaned', limit: 1 });
      expect(kitchen.body.data.hits[0]).toMatchObject({
        documentId: kitchenDoc.id,
        documentTitle: 'מטבח-המשרד',
      });
    });

    it('honours knowledgeBaseIds, minScore, limit and validates input', async () => {
      const other = await createBase('Empty base');
      const scoped = await search({ query: 'refund policy', knowledgeBaseIds: [other.id] });
      expect(scoped.status).toBe(200);
      expect(scoped.body.data.hits).toEqual([]);
      const inBase = await search({ query: 'refund policy', knowledgeBaseIds: [base.id] });
      expect(inBase.body.data.hits[0].documentId).toBe(refundDoc.id);
      const strict = await search({ query: 'quantum chromodynamics lattice', minScore: 0.6 });
      expect(strict.body.data.hits).toEqual([]);
      const limited = await search({ query: 'office', limit: 1, minScore: 0 });
      expect(limited.body.data.hits).toHaveLength(1);
      expect((await search({ query: '' })).status).toBe(400);
      expect((await search({ query: 'x', limit: 99 })).status).toBe(400);
      expect(
        (await search({ query: 'x', knowledgeBaseIds: ['00000000-0000-4000-8000-000000000000'] }))
          .status,
      ).toBe(404);
      const m = await as(ctx, member, orgId)
        .post('/api/v1/knowledge/search')
        .send({ query: 'refund' });
      expect(m.status).toBe(200); // members hold knowledge:read
    });

    it('records embedding usage for ingestion and for searches', async () => {
      const logs = await ctx.prisma.client.aiRequestLog.findMany({
        where: { organizationId: orgId, operation: 'embed' },
      });
      expect(logs.length).toBeGreaterThanOrEqual(3);
      expect(logs.every((l) => l.provider === 'mock' && l.model === 'mock-embedding')).toBe(true);
      const purposes = new Set(logs.map((l) => (l.metadata as { purpose?: string }).purpose));
      expect(purposes).toEqual(new Set(['document_ingest', 'knowledge_search']));
      const tokens = await ctx.prisma.client.usageRecord.aggregate({
        where: { organizationId: orgId, metric: 'ai_tokens' },
        _sum: { quantity: true },
      });
      expect(Number(tokens._sum.quantity)).toBeGreaterThan(0);
    });
  });

  describe('the knowledge.search tool (assistant / agents)', () => {
    const run = (permissions: string[], input: Record<string, unknown>) =>
      new ToolExecutor(ctx.app.get(ToolRegistry)).execute(
        {
          organizationId: orgId,
          userId: owner.user.id,
          agentId: null,
          executionId: null,
          prisma: ctx.prisma.client,
          logger: { debug() {}, info() {}, warn() {}, error() {} },
          signal: new AbortController().signal,
          now: () => new Date(),
        },
        { allowedTools: ['knowledge.search'], permissions, allowWrite: false },
        { id: 't1', name: 'knowledge.search', input },
      );

    it('returns attributed passages wrapped as untrusted data', async () => {
      const outcome = await run(['knowledge:read'], { query: 'refund policy returns' });
      expect(outcome.status).toBe('ok');
      const passages = (outcome.result.data as { passages: Array<Record<string, unknown>> })
        .passages;
      expect(passages[0]).toMatchObject({
        source: 'Refund Policy (chunk 0)',
        documentId: refundDoc.id,
      });
      expect(passages[0]!.content).toMatch(
        /^<data source="knowledge:[^"]+">[\s\S]*thirty days[\s\S]*<\/data>$/,
      );
    });

    it('is permission-gated', async () => {
      const outcome = await run([], { query: 'refund' });
      expect(outcome.status).toBe('denied');
    });

    it('is listed in the tool catalogue with its permission', async () => {
      const res = await api().get('/api/v1/ai/tools');
      const tool = (res.body.data as Array<{ key: string; requiredPermission: string }>).find(
        (t) => t.key === 'knowledge.search',
      );
      expect(tool?.requiredPermission).toBe('knowledge:read');
    });
  });

  describe('download', () => {
    it('streams the original file as an attachment with hardening headers', async () => {
      const res = await api()
        .get(`/api/v1/knowledge/documents/${refundDoc.id}/download`)
        .buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="refund-policy\.txt"/,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.text).toBe(REFUND);
      const heb = await api().get(`/api/v1/knowledge/documents/${kitchenDoc.id}/download`);
      expect(heb.headers['content-disposition']).toContain(
        `filename*=UTF-8''${encodeURIComponent('מטבח-המשרד.md')}`,
      );
      expect(
        (await request(ctx.http).get(`/api/v1/knowledge/documents/${refundDoc.id}/download`))
          .status,
      ).toBe(401);
    });
  });

  describe('file validation', () => {
    const expectRejected = async (
      res: request.Response,
      status: number,
      code: ErrorCode,
      before: number,
    ) => {
      expect(res.status).toBe(status);
      expect(res.body.error.code).toBe(code);
      expect(await ctx.prisma.client.document.count({ where: { organizationId: orgId } })).toBe(
        before,
      );
    };
    let before: number;
    beforeAll(async () => {
      before = await ctx.prisma.client.document.count({ where: { organizationId: orgId } });
    });

    it('rejects unsupported extensions and content types (415)', async () => {
      await expectRejected(
        await upload(base.id, 'MZ...', 'setup.exe', 'application/octet-stream'),
        415,
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        before,
      );
      await expectRejected(
        await upload(base.id, 'hello', 'photo.png', 'image/png'),
        415,
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        before,
      );
      await expectRejected(
        await upload(base.id, 'hello', 'notes.txt', 'application/x-msdownload'),
        415,
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        before,
      );
      await expectRejected(
        await upload(base.id, 'hello', 'noextension', 'text/plain'),
        415,
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        before,
      );
    });

    it('rejects extension / content-type mismatches and spoofed content', async () => {
      await expectRejected(
        await upload(base.id, '%PDF-1.4', 'doc.txt', 'application/pdf'),
        415,
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        before,
      );
      await expectRejected(
        await upload(base.id, 'not a pdf at all', 'fake.pdf', 'application/pdf'),
        415,
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        before,
      );
      await expectRejected(
        await upload(
          base.id,
          Buffer.from([0x68, 0x69, 0x00, 0x01, 0x02]),
          'binary.txt',
          'text/plain',
        ),
        415,
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        before,
      );
    });

    it('rejects empty files, a missing file and oversize files', async () => {
      await expectRejected(
        await upload(base.id, Buffer.alloc(0), 'empty.txt'),
        400,
        ErrorCode.VALIDATION_ERROR,
        before,
      );
      const none = await api()
        .post(`/api/v1/knowledge/bases/${base.id}/documents`)
        .field('title', 'x');
      await expectRejected(none, 400, ErrorCode.VALIDATION_ERROR, before);
      const wrongField = await api()
        .post(`/api/v1/knowledge/bases/${base.id}/documents`)
        .attach('upload', Buffer.from('hi'), { filename: 'a.txt', contentType: 'text/plain' });
      expect(wrongField.status).toBe(400);
      await expectRejected(
        await upload(base.id, Buffer.alloc(1024 * 1024 + 10, 0x61), 'big.txt'),
        413,
        ErrorCode.PAYLOAD_TOO_LARGE,
        before,
      );
    });

    it('sanitises hostile file names and never stores them in the key', async () => {
      const res = await upload(base.id, 'harmless text content', '../../etc/pass"wd.txt');
      expect(res.status).toBe(201);
      expect(res.body.data.fileName).toBe('passwd.txt');
      const row = await ctx.prisma.client.document.findUniqueOrThrow({
        where: { id: res.body.data.id },
      });
      expect(row.storageKey).not.toContain('passwd');
      expect(row.storageKey).not.toContain('..');
      await api().delete(`/api/v1/knowledge/documents/${res.body.data.id}`);
    });
  });

  describe('failures, reprocess and delete', () => {
    it('marks documents failed with a clear error and allows reprocessing', async () => {
      const bad = (await upload(base.id, '{ not json', 'broken.json', 'application/json')).body
        .data as Document;
      const outcome = runWorker(bad);
      await expect(outcome).rejects.toMatchObject({ permanent: true, code: 'invalid_content' });
      const failed = await getDoc(bad.id);
      expect(failed.status).toBe('failed');
      expect(failed.error).toMatch(/not valid JSON/);
      expect(failed.chunkCount).toBe(0);

      const pdf = (await upload(base.id, '%PDF-1.4 minimal', 'scan.pdf', 'application/pdf')).body
        .data as Document;
      await expect(runWorker(pdf)).rejects.toMatchObject({
        permanent: true,
        code: 'unsupported_type',
      });
      expect((await getDoc(pdf.id)).error).toMatch(/PDF text extraction is not available/);

      const list = await api().get(`/api/v1/knowledge/bases/${base.id}/documents?status=failed`);
      expect(list.body.data.map((d: Document) => d.id).sort()).toEqual([bad.id, pdf.id].sort());

      // The user fixes the problem (here: nothing) and asks for another run → back to "uploaded" + new job.
      const reprocessed = await api().post(`/api/v1/knowledge/documents/${bad.id}/reprocess`);
      expect(reprocessed.status).toBe(202);
      expect(reprocessed.body.data).toMatchObject({
        status: 'uploaded',
        error: null,
        chunkCount: 0,
      });
      const jobs = (await jobsOn(ctx, QueueName.DOCUMENT_PROCESSING)).filter(
        (j) => j.data.documentId === bad.id,
      );
      expect(jobs.length).toBe(2);
      expect(new Set(jobs.map((j) => j.data.idempotencyKey)).size).toBe(2);
    });

    it('reprocessing a ready document replaces its chunks without duplicates', async () => {
      const before = await getDoc(refundDoc.id);
      const res = await api().post(`/api/v1/knowledge/documents/${refundDoc.id}/reprocess`);
      expect(res.status).toBe(202);
      expect(res.body.data.status).toBe('uploaded');
      expect(
        await search({ query: 'refund policy' }).then((r) =>
          r.body.data.hits.filter((h: { documentId: string }) => h.documentId === refundDoc.id),
        ),
      ).toEqual([]);
      expect((await runWorker(refundDoc)).status).toBe('ready');
      const after = await getDoc(refundDoc.id);
      expect(after.status).toBe('ready');
      expect(after.chunkCount).toBe(before.chunkCount);
      const count = await ctx.prisma.client.documentChunk.count({
        where: { documentId: refundDoc.id },
      });
      expect(count).toBe(before.chunkCount);
    });

    it('rejects reprocessing while processing', async () => {
      await ctx.prisma.client.document.update({
        where: { id: kitchenDoc.id },
        data: { status: 'processing' },
      });
      const res = await api().post(`/api/v1/knowledge/documents/${kitchenDoc.id}/reprocess`);
      expect(res.status).toBe(409);
      await ctx.prisma.client.document.update({
        where: { id: kitchenDoc.id },
        data: { status: 'ready' },
      });
    });

    it('deleting a document removes chunks, the stored file and updates counts', async () => {
      const row = await ctx.prisma.client.document.findUniqueOrThrow({
        where: { id: kitchenDoc.id },
      });
      const res = await api().delete(`/api/v1/knowledge/documents/${kitchenDoc.id}`);
      expect(res.status).toBe(204);
      expect(
        await ctx.prisma.client.documentChunk.count({ where: { documentId: kitchenDoc.id } }),
      ).toBe(0);
      expect(await storage.head(row.storageKey)).toBeNull();
      expect((await api().get(`/api/v1/knowledge/documents/${kitchenDoc.id}`)).status).toBe(404);
      const hits = (await search({ query: 'kitchen cleaned friday' })).body.data.hits as Array<{
        documentId: string;
      }>;
      expect(hits.find((h) => h.documentId === kitchenDoc.id)).toBeUndefined();
    });

    it('deleting a knowledge base cascades to documents, chunks and files', async () => {
      const doomed = await createBase('Doomed');
      const doc = (await upload(doomed.id, 'temporary text about llamas', 'llamas.txt')).body
        .data as Document;
      await runWorker(doc);
      const row = await ctx.prisma.client.document.findUniqueOrThrow({ where: { id: doc.id } });
      expect((await api().delete(`/api/v1/knowledge/bases/${doomed.id}`)).status).toBe(204);
      expect(
        await ctx.prisma.client.document.count({ where: { knowledgeBaseId: doomed.id } }),
      ).toBe(0);
      expect(
        await ctx.prisma.client.documentChunk.count({ where: { knowledgeBaseId: doomed.id } }),
      ).toBe(0);
      expect(await storage.head(row.storageKey)).toBeNull();
      expect((await api().get(`/api/v1/knowledge/bases/${doomed.id}`)).status).toBe(404);
    });
  });

  describe('entitlements and provider configuration', () => {
    it('enforces the plan document and storage limits (402)', async () => {
      const limited = await createBase('Limited');
      const sub = await ctx.prisma.client.subscription.findUniqueOrThrow({
        where: { organizationId: orgId },
      });
      const current = await ctx.prisma.client.document.count({ where: { organizationId: orgId } });
      const original = sub.limits as Record<string, number>;
      try {
        await ctx.prisma.client.subscription.update({
          where: { organizationId: orgId },
          data: { limits: { ...original, knowledgeDocuments: current } },
        });
        const res = await upload(limited.id, 'one more', 'extra.txt');
        expect(res.status).toBe(402);
        expect(res.body.error.code).toBe(ErrorCode.ENTITLEMENT_EXCEEDED);
        expect(res.body.error.details).toMatchObject({ metric: 'documents', limit: current });

        await ctx.prisma.client.subscription.update({
          where: { organizationId: orgId },
          data: { limits: { ...original, knowledgeDocuments: current + 5, storageMb: 0 } },
        });
        const storageRes = await upload(limited.id, 'one more', 'extra.txt');
        expect(storageRes.status).toBe(402);
        expect(storageRes.body.error.details).toMatchObject({ metric: 'storage_mb' });
      } finally {
        await ctx.prisma.client.subscription.update({
          where: { organizationId: orgId },
          data: { limits: original },
        });
      }
      expect((await upload(limited.id, 'now it fits', 'extra.txt')).status).toBe(201);
    });

    it('answers 409 AI_NOT_CONFIGURED when the organization cannot embed', async () => {
      const lonely = await register(ctx, { firstName: 'No', lastName: 'Provider' });
      const lonelyOrg = (await createOrganization(ctx, lonely, 'No AI Co')).id;
      const lonelyApi = as(ctx, lonely, lonelyOrg);
      const lonelyBase = (await lonelyApi.post('/api/v1/knowledge/bases').send({ name: 'KB' })).body
        .data;
      expect(lonelyBase.embeddingProviderConfigId).toBeNull();
      const up = await lonelyApi
        .post(`/api/v1/knowledge/bases/${lonelyBase.id}/documents`)
        .attach('file', Buffer.from('some text'), { filename: 'a.txt', contentType: 'text/plain' });
      expect(up.status).toBe(409);
      expect(up.body.error.code).toBe(ErrorCode.AI_NOT_CONFIGURED);
      const s = await lonelyApi.post('/api/v1/knowledge/search').send({ query: 'hello' });
      expect(s.status).toBe(409);
      expect(s.body.error.code).toBe(ErrorCode.AI_NOT_CONFIGURED);
    });
  });

  describe('audit trail', () => {
    it('records knowledge base and document actions', async () => {
      const rows = await ctx.prisma.client.auditLog.findMany({
        where: { organizationId: orgId, action: { startsWith: 'knowledge_base.' } },
      });
      const docRows = await ctx.prisma.client.auditLog.findMany({
        where: { organizationId: orgId, action: { startsWith: 'document.' } },
      });
      const actions = new Set([...rows, ...docRows].map((r) => r.action));
      for (const action of [
        AuditAction.KNOWLEDGE_BASE_CREATED,
        AuditAction.KNOWLEDGE_BASE_UPDATED,
        AuditAction.KNOWLEDGE_BASE_DELETED,
        AuditAction.DOCUMENT_UPLOADED,
        AuditAction.DOCUMENT_REPROCESSED,
        AuditAction.DOCUMENT_DOWNLOADED,
        AuditAction.DOCUMENT_DELETED,
      ]) {
        expect(actions).toContain(action);
      }
      expect(rows.every((r) => r.actorUserId === owner.user.id)).toBe(true);
    });
  });
});
