import { refreshKnowledgeBaseCounts } from '@hilatech/ai-engine';
import {
  AuditAction,
  type Document as DocumentDto,
  type DocumentChunk as DocumentChunkDto,
  type ListDocumentsQuery,
  type PaginationQuery,
  QueueName,
  type UploadDocumentFields,
} from '@hilatech/contracts';
import { type Prisma } from '@hilatech/database';
import { type StorageDriver, buildObjectKey, sha256Hex } from '@hilatech/storage';
import { type TenantContext } from '@hilatech/types';
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { type Readable } from 'node:stream';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { STORAGE_DRIVER } from '../../infrastructure/storage/storage.module';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { type UploadedFileLike, titleFromFileName, validateUpload } from './file-validation';
import { toDocument, toDocumentChunk } from './knowledge.mappers';
import { KnowledgeBasesService } from './knowledge-bases.service';

const MB = 1024 * 1024;
/** A document stuck in `processing` longer than this may be reprocessed (worker died mid-job). */
export const STUCK_PROCESSING_MS = 10 * 60 * 1000;

export interface DocumentDownload {
  stream: Readable;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bases: KnowledgeBasesService,
    private readonly entitlements: EntitlementsService,
    private readonly queue: QueueService,
    private readonly config: AppConfig,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly logger: Logger,
  ) {}

  get maxUploadBytes(): number {
    return this.config.get('MAX_UPLOAD_MB') * MB;
  }

  async list(
    tenant: TenantContext,
    knowledgeBaseId: string,
    query: ListDocumentsQuery,
  ): Promise<PageResult<DocumentDto>> {
    await this.bases.require(tenant, knowledgeBaseId);
    const where: Prisma.DocumentWhereInput = {
      organizationId: tenant.organizationId,
      knowledgeBaseId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { fileName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.document.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        ...skipTake(query),
      }),
      this.prisma.client.document.count({ where }),
    ]);
    return page(rows.map(toDocument), query, total);
  }

  async get(tenant: TenantContext, id: string): Promise<DocumentDto> {
    return toDocument(await this.require(tenant, id));
  }

  async listChunks(
    tenant: TenantContext,
    id: string,
    query: PaginationQuery,
  ): Promise<PageResult<DocumentChunkDto>> {
    const document = await this.require(tenant, id);
    const where = { documentId: document.id, organizationId: tenant.organizationId };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.documentChunk.findMany({
        where,
        orderBy: { index: 'asc' },
        select: {
          id: true,
          documentId: true,
          index: true,
          content: true,
          tokenCount: true,
          metadata: true,
        },
        ...skipTake(query),
      }),
      this.prisma.client.documentChunk.count({ where }),
    ]);
    return page(rows.map(toDocumentChunk), query, total);
  }

  async upload(
    tenant: TenantContext,
    knowledgeBaseId: string,
    file: UploadedFileLike | undefined,
    fields: UploadDocumentFields,
    meta: RequestMeta,
  ): Promise<DocumentDto> {
    const base = await this.bases.require(tenant, knowledgeBaseId);
    const upload = validateUpload(file, this.maxUploadBytes);
    await this.assertEntitled(tenant, upload.sizeBytes);
    await this.bases.assertEmbeddingsAvailable(tenant, base);

    const key = buildObjectKey(tenant.organizationId, 'documents', upload.fileName);
    await this.storage.put({
      key,
      body: upload.buffer,
      contentType: upload.mimeType,
      metadata: { organizationId: tenant.organizationId },
    });

    let document;
    try {
      document = await this.prisma.client.document.create({
        data: {
          organizationId: tenant.organizationId,
          knowledgeBaseId: base.id,
          title: fields.title ?? titleFromFileName(upload.fileName),
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          storageKey: key,
          checksum: sha256Hex(upload.buffer),
          status: 'uploaded',
          uploadedById: tenant.userId,
        },
      });
    } catch (error) {
      await this.discardObject(key);
      throw error;
    }

    try {
      await this.enqueueProcessing(tenant.organizationId, document.id, base.id, meta, 'initial');
    } catch (error) {
      // Never leave an upload that nothing will process: undo it and let the client retry.
      await this.prisma.client.document.deleteMany({
        where: { id: document.id, organizationId: tenant.organizationId },
      });
      await this.discardObject(key);
      throw error;
    }
    await refreshKnowledgeBaseCounts(this.prisma.client, tenant.organizationId, base.id);
    await this.audit.log({
      action: AuditAction.DOCUMENT_UPLOADED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'document',
      targetId: document.id,
      metadata: {
        knowledgeBaseId: base.id,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
      },
      request: meta,
    });
    return toDocument(document);
  }

  /** Re-runs the pipeline (after a failure, a provider change, or to refresh the index). */
  async reprocess(tenant: TenantContext, id: string, meta: RequestMeta): Promise<DocumentDto> {
    const document = await this.require(tenant, id);
    const base = await this.bases.require(tenant, document.knowledgeBaseId);
    if (
      document.status === 'processing' &&
      Date.now() - document.updatedAt.getTime() < STUCK_PROCESSING_MS
    ) {
      throw AppException.conflict('The document is currently being processed');
    }
    await this.bases.assertEmbeddingsAvailable(tenant, base);

    const claimed = await this.prisma.client.document.updateMany({
      where: { id: document.id, organizationId: tenant.organizationId, status: document.status },
      data: { status: 'uploaded', error: null, chunkCount: 0, processedAt: null },
    });
    if (claimed.count === 0) throw AppException.conflict('The document changed, try again');
    await this.prisma.client.documentChunk.deleteMany({
      where: { documentId: document.id, organizationId: tenant.organizationId },
    });
    await refreshKnowledgeBaseCounts(this.prisma.client, tenant.organizationId, base.id);
    await this.enqueueProcessing(tenant.organizationId, document.id, base.id, meta, 'reprocess');
    await this.audit.log({
      action: AuditAction.DOCUMENT_REPROCESSED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'document',
      targetId: document.id,
      metadata: { knowledgeBaseId: base.id, previousStatus: document.status },
      request: meta,
    });
    return this.get(tenant, document.id);
  }

  async remove(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const document = await this.require(tenant, id);
    await this.prisma.client.document.deleteMany({
      where: { id: document.id, organizationId: tenant.organizationId },
    });
    await this.discardObject(document.storageKey);
    await refreshKnowledgeBaseCounts(
      this.prisma.client,
      tenant.organizationId,
      document.knowledgeBaseId,
    );
    await this.audit.log({
      action: AuditAction.DOCUMENT_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'document',
      targetId: document.id,
      metadata: { knowledgeBaseId: document.knowledgeBaseId, fileName: document.fileName },
      request: meta,
    });
  }

  /** Tenant-checked download: the storage key never leaves the server. */
  async download(tenant: TenantContext, id: string, meta: RequestMeta): Promise<DocumentDownload> {
    const document = await this.require(tenant, id);
    let stream: Readable;
    try {
      stream = await this.storage.getStream(document.storageKey);
    } catch {
      throw AppException.notFound('Document file');
    }
    await this.audit.log({
      action: AuditAction.DOCUMENT_DOWNLOADED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'document',
      targetId: document.id,
      metadata: { fileName: document.fileName },
      request: meta,
    });
    return {
      stream,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
    };
  }

  private async require(tenant: TenantContext, id: string) {
    const document = await this.prisma.client.document.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!document) throw AppException.notFound('Document');
    return document;
  }

  /** Plan limits `knowledgeDocuments` and `storageMb` apply to what the organization stores right now. */
  private async assertEntitled(tenant: TenantContext, incomingBytes: number): Promise<void> {
    const limits = await this.entitlements.getLimits(tenant.organizationId);
    const [count, size] = await Promise.all([
      this.prisma.client.document.count({ where: { organizationId: tenant.organizationId } }),
      this.prisma.client.document.aggregate({
        where: { organizationId: tenant.organizationId },
        _sum: { sizeBytes: true },
      }),
    ]);
    if (count >= limits.knowledgeDocuments) {
      throw AppException.entitlementExceeded(
        `Plan limit reached for documents (${count}/${limits.knowledgeDocuments})`,
        { metric: 'documents', used: count, limit: limits.knowledgeDocuments },
      );
    }
    const usedBytes = Number(size._sum.sizeBytes ?? 0);
    if (usedBytes + incomingBytes > limits.storageMb * MB) {
      throw AppException.entitlementExceeded(
        `Plan storage limit reached (${limits.storageMb} MB)`,
        {
          metric: 'storage_mb',
          usedMb: Math.ceil(usedBytes / MB),
          limit: limits.storageMb,
        },
      );
    }
  }

  private async enqueueProcessing(
    organizationId: string,
    documentId: string,
    knowledgeBaseId: string,
    meta: RequestMeta,
    reason: 'initial' | 'reprocess',
  ): Promise<void> {
    await this.queue.enqueue(QueueName.DOCUMENT_PROCESSING, {
      organizationId,
      documentId,
      knowledgeBaseId,
      // BullMQ collapses equal job ids: the first run is keyed by the document, re-runs get a fresh key.
      idempotencyKey:
        reason === 'initial'
          ? `doc-process-${documentId}`
          : `doc-process-${documentId}-${Date.now().toString(36)}`,
      requestId: meta.requestId ?? undefined,
      enqueuedAt: new Date().toISOString(),
    });
  }

  private async discardObject(key: string): Promise<void> {
    await this.storage.delete(key).catch((error: unknown) => {
      this.logger.warn({ err: error, key }, 'Could not delete stored file', DocumentsService.name);
    });
  }
}
