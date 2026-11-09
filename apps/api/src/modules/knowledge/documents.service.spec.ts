import { ALL_PERMISSIONS, ErrorCode, QueueName } from '@hilatech/contracts';

import { DocumentsService, STUCK_PROCESSING_MS } from './documents.service';

const ORG = '22222222-2222-4222-8222-222222222222';
const tenant = {
  organizationId: ORG,
  userId: 'u1',
  memberId: 'm1',
  roleId: 'r1',
  roleKey: 'owner',
  permissions: ALL_PERMISSIONS,
};
const meta = { ipAddress: null, userAgent: null, requestId: 'req-1' };
const txt = (content = 'hello world') => ({
  originalname: 'notes.txt',
  mimetype: 'text/plain',
  size: Buffer.byteLength(content),
  buffer: Buffer.from(content),
});

function setup(options: { docs?: number; bytes?: number; limits?: Record<string, number> } = {}) {
  const base = {
    id: 'kb1',
    organizationId: ORG,
    embeddingProviderConfigId: null,
    embeddingModel: null,
  };
  const created: Array<Record<string, unknown>> = [];
  const documentRow = (data: Record<string, unknown>) => ({
    id: 'd1',
    createdAt: new Date(),
    updatedAt: new Date(),
    error: null,
    pageCount: null,
    chunkCount: 0,
    metadata: {},
    processedAt: null,
    ...data,
  });
  const prisma = {
    client: {
      document: {
        count: jest.fn().mockResolvedValue(options.docs ?? 0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: options.bytes ?? 0 } }),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return documentRow(data);
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
      },
      documentChunk: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      knowledgeBase: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    },
  };
  prisma.client.document.aggregate.mockImplementation(
    async (args: { _sum?: { sizeBytes?: boolean; chunkCount?: boolean } }) =>
      args._sum?.chunkCount
        ? { _sum: { chunkCount: 0 } }
        : { _sum: { sizeBytes: options.bytes ?? 0 } },
  );
  const storage = {
    put: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    getStream: jest.fn(),
  };
  const queue = {
    enqueue: jest.fn().mockResolvedValue({ jobId: 'j', queue: 'document-processing' }),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const bases = {
    require: jest.fn().mockResolvedValue(base),
    assertEmbeddingsAvailable: jest.fn().mockResolvedValue(undefined),
  };
  const entitlements = {
    getLimits: jest
      .fn()
      .mockResolvedValue({ knowledgeDocuments: 10, storageMb: 1, ...options.limits }),
  };
  const config = { get: jest.fn().mockReturnValue(1) };
  const logger = { warn: jest.fn() };
  const service = new DocumentsService(
    prisma as never,
    audit as never,
    bases as never,
    entitlements as never,
    queue as never,
    config as never,
    storage as never,
    logger as never,
  );
  return { service, prisma, storage, queue, audit, bases, created };
}

describe('DocumentsService.upload', () => {
  it('stores the file under an org-scoped key, creates the document and enqueues processing', async () => {
    const { service, storage, queue, created, audit } = setup();
    const doc = await service.upload(tenant, 'kb1', txt(), {}, meta);
    expect(doc.status).toBe('uploaded');
    expect(doc.title).toBe('notes');
    const key = (storage.put.mock.calls[0]![0] as { key: string }).key;
    expect(key).toMatch(new RegExp(`^org/${ORG}/documents/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.txt$`));
    expect(created[0]).toMatchObject({
      organizationId: ORG,
      knowledgeBaseId: 'kb1',
      storageKey: key,
      status: 'uploaded',
    });
    expect(created[0]!.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(queue.enqueue).toHaveBeenCalledWith(
      QueueName.DOCUMENT_PROCESSING,
      expect.objectContaining({
        organizationId: ORG,
        documentId: 'd1',
        knowledgeBaseId: 'kb1',
        idempotencyKey: 'doc-process-d1',
        requestId: 'req-1',
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.uploaded' }),
    );
  });

  it('rejects invalid files before touching storage', async () => {
    const { service, storage } = setup();
    await expect(
      service.upload(tenant, 'kb1', { ...txt(), originalname: 'x.exe' }, {}, meta),
    ).rejects.toMatchObject({ code: ErrorCode.UNSUPPORTED_MEDIA_TYPE });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('enforces the document-count and storage entitlements (402) before storing', async () => {
    const full = setup({ docs: 10 });
    await expect(full.service.upload(tenant, 'kb1', txt(), {}, meta)).rejects.toMatchObject({
      code: ErrorCode.ENTITLEMENT_EXCEEDED,
    });
    expect(full.storage.put).not.toHaveBeenCalled();
    const heavy = setup({ bytes: 1024 * 1024 - 5 });
    await expect(heavy.service.upload(tenant, 'kb1', txt(), {}, meta)).rejects.toMatchObject({
      code: ErrorCode.ENTITLEMENT_EXCEEDED,
    });
    expect(heavy.storage.put).not.toHaveBeenCalled();
  });

  it('removes the stored object when the database insert fails', async () => {
    const { service, storage, prisma } = setup();
    prisma.client.document.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.upload(tenant, 'kb1', txt(), {}, meta)).rejects.toThrow('db down');
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it('rolls the upload back when the job cannot be queued', async () => {
    const { service, storage, queue, prisma } = setup();
    queue.enqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.upload(tenant, 'kb1', txt(), {}, meta)).rejects.toThrow('redis down');
    expect(prisma.client.document.deleteMany).toHaveBeenCalledWith({
      where: { id: 'd1', organizationId: ORG },
    });
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});

describe('DocumentsService.reprocess', () => {
  const row = (status: string, ageMs: number) => ({
    id: 'd1',
    organizationId: ORG,
    knowledgeBaseId: 'kb1',
    status,
    updatedAt: new Date(Date.now() - ageMs),
    createdAt: new Date(),
    metadata: {},
  });

  it('refuses while a recent run is in progress but allows stuck ones', async () => {
    const fresh = setup();
    fresh.prisma.client.document.findFirst.mockResolvedValue(row('processing', 1_000));
    await expect(fresh.service.reprocess(tenant, 'd1', meta)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT,
    });
    expect(fresh.queue.enqueue).not.toHaveBeenCalled();

    const stuck = setup();
    stuck.prisma.client.document.findFirst.mockResolvedValue(
      row('processing', STUCK_PROCESSING_MS + 1_000),
    );
    await stuck.service.reprocess(tenant, 'd1', meta);
    expect(stuck.queue.enqueue).toHaveBeenCalledTimes(1);
    const payload = stuck.queue.enqueue.mock.calls[0]![1] as { idempotencyKey: string };
    expect(payload.idempotencyKey).toMatch(/^doc-process-d1-[0-9a-z]+$/);
  });

  it('resets a failed document to uploaded, drops its chunks and re-enqueues with a fresh key', async () => {
    const { service, prisma, queue } = setup();
    prisma.client.document.findFirst.mockResolvedValue(row('failed', 60_000));
    await service.reprocess(tenant, 'd1', meta);
    expect(prisma.client.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', organizationId: ORG, status: 'failed' },
      data: { status: 'uploaded', error: null, chunkCount: 0, processedAt: null },
    });
    expect(prisma.client.documentChunk.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'd1', organizationId: ORG },
    });
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });
});
