/**
 * Integration: the `document-processing` consumer against the real workers application (isolated BullMQ
 * prefix `hta-test`), the `hilatech_test` database, local Redis and the local storage driver. Files are
 * written exactly like the API does (tenant-scoped key, checksum), the job is enqueued with the contract
 * payload, and the assertions look at what the worker left behind: document status/error, chunks, vectors,
 * usage and retrieval — including cross-tenant checks. Everything created is removed afterwards.
 */
import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ALL_PERMISSIONS, DEFAULT_JOB_OPTIONS, QueueName } from '@hilatech/contracts';
import { buildObjectKey, sha256Hex, type StorageDriver } from '@hilatech/storage';
import { Queue, QueueEvents } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { AiRuntime } from '../src/ai/ai-runtime';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { STORAGE_DRIVER } from '../src/storage/storage.module';
import { RedisService } from '../src/redis/redis.service';
import { makePdf } from './helpers/make-pdf';

const PREFIX = process.env.BULLMQ_PREFIX!;

interface Tenant {
  organizationId: string;
  userId: string;
  knowledgeBaseId: string;
}

describe('document-processing (integration)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let storage: StorageDriver;
  let runtime: AiRuntime;
  let connection: RedisOptions;
  let producer: Queue;
  let automation: Queue;
  let events: QueueEvents;
  let a: Tenant;
  let b: Tenant;

  const createTenant = async (label: string): Promise<Tenant> => {
    const user = await prisma.client.user.create({
      data: {
        email: `doc-int-${label}-${randomUUID()}@test.local`,
        passwordHash: 'not-a-real-hash',
        firstName: label,
        lastName: 'Doc',
      },
      select: { id: true },
    });
    const org = await prisma.client.organization.create({
      data: {
        name: `Doc Int ${label}`,
        slug: `doc-int-${label}-${randomUUID().slice(0, 8)}`,
        roles: {
          create: {
            key: 'owner',
            name: 'Owner',
            isSystem: true,
            permissions: [...ALL_PERMISSIONS],
          },
        },
      },
      select: { id: true },
    });
    const config = await prisma.client.aiProviderConfig.create({
      data: {
        organizationId: org.id,
        provider: 'mock',
        name: 'Mock',
        defaultModel: 'mock-chat',
        isDefault: true,
        isEnabled: true,
      },
      select: { id: true },
    });
    const kb = await prisma.client.knowledgeBase.create({
      data: {
        organizationId: org.id,
        name: `KB ${label}`,
        embeddingProviderConfigId: config.id,
        createdById: user.id,
      },
      select: { id: true },
    });
    return { organizationId: org.id, userId: user.id, knowledgeBaseId: kb.id };
  };

  /** Mirrors the API upload: store the object, create Document(uploaded). */
  const createDocument = async (
    t: Tenant,
    fileName: string,
    mimeType: string,
    body: Buffer | string,
    extra: { title?: string } = {},
  ) => {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const key = buildObjectKey(t.organizationId, 'documents', fileName);
    await storage.put({ key, body: buffer, contentType: mimeType });
    return prisma.client.document.create({
      data: {
        organizationId: t.organizationId,
        knowledgeBaseId: t.knowledgeBaseId,
        title: extra.title ?? fileName,
        fileName,
        mimeType,
        sizeBytes: buffer.length,
        storageKey: key,
        checksum: sha256Hex(buffer),
        uploadedById: t.userId,
      },
    });
  };

  const enqueue = async (
    t: Tenant,
    documentId: string,
    options: { organizationId?: string; attempts?: number } = {},
  ) => {
    const idempotencyKey = `doc-int-${randomUUID()}`;
    const job = await producer.add(
      QueueName.DOCUMENT_PROCESSING,
      {
        organizationId: options.organizationId ?? t.organizationId,
        documentId,
        knowledgeBaseId: t.knowledgeBaseId,
        idempotencyKey,
        enqueuedAt: new Date().toISOString(),
      },
      { ...DEFAULT_JOB_OPTIONS, attempts: options.attempts ?? 1, jobId: idempotencyKey },
    );
    return job;
  };
  const runOk = async (t: Tenant, documentId: string) => {
    const job = await enqueue(t, documentId);
    return (await job.waitUntilFinished(events, 30_000)) as Record<string, unknown>;
  };
  const doc = (id: string) => prisma.client.document.findUniqueOrThrow({ where: { id } });
  const search = (t: Tenant, query: string, limit = 5) =>
    runtime.knowledgeSearcher.query(t.organizationId, { query, limit, minScore: 0.1 });

  beforeAll(async () => {
    expect(PREFIX).toBe('hta-test');
    expect(process.env.DATABASE_URL).toMatch(/_test(\?|$)/);
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    prisma = app.get(PrismaService);
    storage = app.get<StorageDriver>(STORAGE_DRIVER);
    runtime = app.get(AiRuntime);
    connection = app.get(RedisService).connectionOptions;
    producer = new Queue(QueueName.DOCUMENT_PROCESSING, {
      connection: { ...connection },
      prefix: PREFIX,
    });
    automation = new Queue(QueueName.AUTOMATION, { connection: { ...connection }, prefix: PREFIX });
    events = new QueueEvents(QueueName.DOCUMENT_PROCESSING, {
      connection: { ...connection },
      prefix: PREFIX,
    });
    await events.waitUntilReady();
    await producer.drain(true);
    await automation.drain(true);
    a = await createTenant('a');
    b = await createTenant('b');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.client.organization
        .deleteMany({
          where: { id: { in: [a?.organizationId, b?.organizationId].filter(Boolean) } },
        })
        .catch(() => undefined);
      await prisma.client.user
        .deleteMany({ where: { id: { in: [a?.userId, b?.userId].filter(Boolean) } } })
        .catch(() => undefined);
    }
    await events?.close();
    await producer?.obliterate({ force: true }).catch(() => undefined);
    await producer?.close();
    await automation?.obliterate({ force: true }).catch(() => undefined);
    await automation?.close();
    await app?.close();
  });

  it('processes a text document end to end: chunks, vectors, ready, usage, KB counters, event', async () => {
    const text =
      '# Refund policy\n\nCustomers may return products within thirty days of purchase for a full refund.\n\n' +
      '## Shipping\n\nStandard shipping takes five business days within the country.';
    const document = await createDocument(a, 'policy.md', 'text/markdown', text, {
      title: 'Policy',
    });
    const result = await runOk(a, document.id);
    expect(result).toMatchObject({
      status: 'completed',
      documentId: document.id,
      embeddingModel: 'mock-embedding',
    });

    const row = await doc(document.id);
    expect(row).toMatchObject({ status: 'ready', error: null });
    expect(row.chunkCount).toBeGreaterThan(0);
    expect(row.processedAt).not.toBeNull();
    const chunks = await prisma.client.documentChunk.findMany({
      where: { documentId: document.id },
      orderBy: { index: 'asc' },
    });
    expect(chunks).toHaveLength(row.chunkCount);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => c.organizationId === a.organizationId)).toBe(true);
    expect(chunks[0]!.metadata).toMatchObject({ offset: 0, heading: 'Refund policy' });
    const [embedded] = await prisma.client.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "DocumentChunk"
      WHERE "documentId" = ${document.id}::uuid AND "embedding" IS NOT NULL`;
    expect(Number(embedded!.n)).toBe(chunks.length);

    const kb = await prisma.client.knowledgeBase.findUniqueOrThrow({
      where: { id: a.knowledgeBaseId },
    });
    expect(kb.documentCount).toBe(1);
    expect(kb.chunkCount).toBe(chunks.length);

    const usage = await prisma.client.aiRequestLog.findMany({
      where: { organizationId: a.organizationId, operation: 'embed' },
    });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage[0]).toMatchObject({
      provider: 'mock',
      model: 'mock-embedding',
      status: 'success',
    });

    const hits = await search(a, 'how long do customers have to return products for a refund');
    expect(hits.hits[0]).toMatchObject({ documentId: document.id, documentTitle: 'Policy' });
    expect(hits.hits[0]!.content).toContain('thirty days');

    // document.processed was published for the automation fan-out
    const emitted = (
      await automation.getJobs(['waiting', 'delayed', 'completed', 'active'], 0, 50)
    ).filter(
      (j) => j.data.event === 'document.processed' && j.data.payload.documentId === document.id,
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.data).toMatchObject({
      kind: 'event',
      organizationId: a.organizationId,
      actorUserId: a.userId,
      payload: { chunkCount: row.chunkCount, title: 'Policy' },
    });
  });

  it('extracts PDFs page by page (pdf-parse) and records the page number in chunk metadata', async () => {
    const pdf = makePdf([
      'Warranty covers manufacturing defects for two years',
      'Contact support at the help desk',
    ]);
    const document = await createDocument(a, 'warranty.pdf', 'application/pdf', pdf);
    expect(await runOk(a, document.id)).toMatchObject({ status: 'completed', pageCount: 2 });
    const row = await doc(document.id);
    expect(row).toMatchObject({ status: 'ready', pageCount: 2 });
    const chunks = await prisma.client.documentChunk.findMany({
      where: { documentId: document.id },
    });
    expect(chunks.map((c) => c.content).join('\n')).toContain('manufacturing defects');
    expect(chunks.some((c) => (c.metadata as { page?: number }).page === 1)).toBe(true);
    const hits = await search(a, 'warranty manufacturing defects');
    expect(hits.hits[0]).toMatchObject({ documentId: document.id });
  });

  it('extracts csv, json and html documents', async () => {
    const csv = await createDocument(
      a,
      'products.csv',
      'text/csv',
      'name,price\nWidget,10\nGadget,25\n',
    );
    const json = await createDocument(
      a,
      'faq.json',
      'application/json',
      JSON.stringify({ faq: [{ q: 'Opening hours', a: 'Nine to five' }] }),
    );
    const html = await createDocument(
      a,
      'about.html',
      'text/html',
      '<html><body><h1>About us</h1><p>We sell widgets &amp; gadgets.</p><script>x()</script></body></html>',
    );
    for (const d of [csv, json, html]) await runOk(a, d.id);
    const chunkText = async (id: string) =>
      (await prisma.client.documentChunk.findMany({ where: { documentId: id } }))
        .map((c) => c.content)
        .join('\n');
    expect(await chunkText(csv.id)).toContain('name: Gadget\nprice: 25');
    expect(await chunkText(json.id)).toContain('faq[0].q: Opening hours');
    const htmlText = await chunkText(html.id);
    expect(htmlText).toContain('We sell widgets & gadgets.');
    expect(htmlText).not.toContain('x()');
    expect((await doc(csv.id)).status).toBe('ready');
  });

  it('is idempotent: a duplicate job for a ready document is skipped and changes nothing', async () => {
    const document = await createDocument(
      a,
      'dup.txt',
      'text/plain',
      'Duplicate delivery test document with some words',
    );
    await runOk(a, document.id);
    const before = await prisma.client.documentChunk.findMany({
      where: { documentId: document.id },
      select: { id: true },
    });
    const again = await runOk(a, document.id);
    expect(again).toMatchObject({ status: 'skipped', reason: 'duplicate' });
    const after = await prisma.client.documentChunk.findMany({
      where: { documentId: document.id },
      select: { id: true },
    });
    expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
  });

  it('retry-safe: a document left in "processing" with stale chunks is reprocessed without duplicates', async () => {
    const document = await createDocument(
      a,
      'retry.txt',
      'text/plain',
      'Retry safety document about quarterly invoices and ledgers',
    );
    await runOk(a, document.id);
    // Simulate a crash mid-run: status processing, an extra stale chunk, no processedAt.
    await prisma.client.document.update({
      where: { id: document.id },
      data: { status: 'processing', processedAt: null },
    });
    await prisma.client.documentChunk.create({
      data: {
        organizationId: a.organizationId,
        knowledgeBaseId: a.knowledgeBaseId,
        documentId: document.id,
        index: 7,
        content: 'stale chunk from a crashed run',
      },
    });
    expect(await runOk(a, document.id)).toMatchObject({ status: 'completed' });
    const chunks = await prisma.client.documentChunk.findMany({
      where: { documentId: document.id },
    });
    expect(chunks.every((c) => !c.content.includes('stale chunk'))).toBe(true);
    expect(new Set(chunks.map((c) => c.index)).size).toBe(chunks.length);
    expect((await doc(document.id)).status).toBe('ready');
  });

  it('fails permanently with a clear error for corrupt, empty and unsupported files (no retries)', async () => {
    const cases: Array<[string, string, Buffer | string, RegExp]> = [
      ['bad.json', 'application/json', '{ nope', /not valid JSON/],
      ['blank.txt', 'text/plain', '   \n  \n', /contains no text/],
      ['broken.pdf', 'application/pdf', '%PDF-1.4 this is not a real pdf', /PDF could not be read/],
      ['latin.txt', 'text/plain', Buffer.from([0xff, 0xfe, 0xfd, 0x80]), /not valid UTF-8/],
      ['odd.bin', 'application/octet-stream', 'abc', /Unsupported document type/],
    ];
    for (const [name, mime, body, pattern] of cases) {
      const document = await createDocument(a, name, mime, body);
      const job = await enqueue(a, document.id, { attempts: 3 });
      await expect(job.waitUntilFinished(events, 30_000)).rejects.toThrow(pattern);
      const row = await doc(document.id);
      expect(row.status).toBe('failed');
      expect(row.error).toMatch(pattern);
      expect(row.chunkCount).toBe(0);
      expect(await prisma.client.documentChunk.count({ where: { documentId: document.id } })).toBe(
        0,
      );
      const fresh = await producer.getJob(job.id!);
      expect(fresh?.attemptsMade).toBe(1); // UnrecoverableError: not retried
    }
    const failedEvents = (
      await automation.getJobs(['waiting', 'delayed', 'completed', 'active'], 0, 100)
    ).filter((j) => j.data.event === 'document.failed');
    expect(failedEvents.length).toBe(cases.length);
    expect(failedEvents[0]!.data.payload.error).toBeTruthy();
  });

  it('fails when the stored file is missing or its checksum does not match', async () => {
    const missing = await createDocument(a, 'gone.txt', 'text/plain', 'will be deleted');
    await storage.delete((await doc(missing.id)).storageKey);
    await expect((await enqueue(a, missing.id)).waitUntilFinished(events, 30_000)).rejects.toThrow(
      /could not be read/,
    );
    expect((await doc(missing.id)).error).toMatch(/Upload the document again/);

    const tampered = await createDocument(
      a,
      'tampered.txt',
      'text/plain',
      'original content of the file',
    );
    await storage.put({
      key: (await doc(tampered.id)).storageKey,
      body: Buffer.from('changed behind our back'),
      contentType: 'text/plain',
    });
    await expect((await enqueue(a, tampered.id)).waitUntilFinished(events, 30_000)).rejects.toThrow(
      /checksum/,
    );
    expect((await doc(tampered.id)).status).toBe('failed');
  });

  it('fails clearly when the organization has no embedding provider', async () => {
    const t = await createTenant('noai');
    try {
      await prisma.client.aiProviderConfig.deleteMany({
        where: { organizationId: t.organizationId },
      });
      const document = await createDocument(
        t,
        'x.txt',
        'text/plain',
        'Some words that cannot be embedded',
      );
      await expect(
        (await enqueue(t, document.id)).waitUntilFinished(events, 30_000),
      ).rejects.toThrow(/Embeddings are not configured/);
      const row = await doc(document.id);
      expect(row.status).toBe('failed');
      expect(row.error).toMatch(/Embeddings are not configured/);
      expect(await prisma.client.documentChunk.count({ where: { documentId: document.id } })).toBe(
        0,
      );
    } finally {
      await prisma.client.organization.deleteMany({ where: { id: t.organizationId } });
      await prisma.client.user.deleteMany({ where: { id: t.userId } });
    }
  });

  it('retries transient errors, and marks the document failed only on the final attempt', async () => {
    const document = await createDocument(
      a,
      'transient.txt',
      'text/plain',
      'Transient failure document with several words',
    );
    const spy = jest
      .spyOn(runtime.embeddings, 'embedTexts')
      .mockRejectedValueOnce(new Error('connection reset'));
    try {
      // First attempt fails transiently, the BullMQ retry succeeds: the document must never be "failed".
      const job = await enqueue(a, document.id, { attempts: 2 });
      expect(await job.waitUntilFinished(events, 30_000)).toMatchObject({ status: 'completed' });
      expect((await producer.getJob(job.id!))?.attemptsMade).toBe(2);
      expect((await doc(document.id)).status).toBe('ready');
    } finally {
      spy.mockRestore();
    }

    const doomed = await createDocument(
      a,
      'doomed.txt',
      'text/plain',
      'Always failing provider document',
    );
    const failing = jest
      .spyOn(runtime.embeddings, 'embedTexts')
      .mockRejectedValue(new Error('connection reset'));
    try {
      const job = await enqueue(a, doomed.id, { attempts: 1 });
      await expect(job.waitUntilFinished(events, 30_000)).rejects.toThrow(/connection reset/);
      const row = await doc(doomed.id);
      expect(row.status).toBe('failed');
      expect(row.error).toMatch(/connection reset/);
    } finally {
      failing.mockRestore();
    }
  });

  it('does nothing for unknown documents or organization mismatches (never touches another tenant)', async () => {
    const document = await createDocument(
      a,
      'tenant-a.txt',
      'text/plain',
      'Tenant A private memo about the merger plan',
    );
    // Payload claims org B but names org A's document → not found for B, A's document untouched.
    const mismatch = await enqueue(a, document.id, { organizationId: b.organizationId });
    expect(await mismatch.waitUntilFinished(events, 30_000)).toMatchObject({
      status: 'skipped',
      reason: 'not_found',
    });
    expect((await doc(document.id)).status).toBe('uploaded');
    const unknown = await enqueue(a, randomUUID());
    expect(await unknown.waitUntilFinished(events, 30_000)).toMatchObject({
      status: 'skipped',
      reason: 'not_found',
    });
  });

  it('cross-tenant retrieval: org B never gets org A chunks, even for identical content', async () => {
    const text =
      'Quarterly revenue forecast for the board meeting: growth of twelve percent expected.';
    const docA = await createDocument(a, 'forecast-a.txt', 'text/plain', text, {
      title: 'Forecast A',
    });
    const docB = await createDocument(b, 'forecast-b.txt', 'text/plain', text, {
      title: 'Forecast B',
    });
    await runOk(a, docA.id);
    await runOk(b, docB.id);
    const forB = await search(b, 'quarterly revenue forecast board meeting growth', 20);
    expect(forB.hits.length).toBeGreaterThan(0);
    expect(forB.hits.every((h) => h.documentId === docB.id)).toBe(true);
    const merger = await search(b, 'Tenant A private memo about the merger plan', 20);
    expect(JSON.stringify(merger.hits)).not.toContain('merger');
    const forA = await search(a, 'quarterly revenue forecast board meeting growth', 20);
    expect(forA.hits.some((h) => h.documentId === docA.id)).toBe(true);
    expect(forA.hits.some((h) => h.documentId === docB.id)).toBe(false);
  });

  it('exposes knowledge.search to agents run by the workers (registry wiring)', async () => {
    const tool = runtime.registry.get('knowledge.search');
    expect(tool).toBeDefined();
    const result = await tool!.execute(
      {
        organizationId: a.organizationId,
        userId: a.userId,
        agentId: null,
        executionId: null,
        prisma: prisma.client,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        signal: new AbortController().signal,
        now: () => new Date(),
      },
      { query: 'thirty days refund', limit: 3 },
    );
    expect(result.ok).toBe(true);
    const passages = (result.data as { passages: Array<{ source: string; content: string }> })
      .passages;
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]!.content.startsWith('<data source=')).toBe(true);
  });
});
