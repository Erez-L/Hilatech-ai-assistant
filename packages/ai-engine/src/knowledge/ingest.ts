import { createHash, randomUUID } from 'node:crypto';

import { type Prisma, type PrismaClient } from '@hilatech/database';

import { AiNotConfiguredError, AiProviderError } from '../errors';
import type { EngineLogger } from '../tools/types';
import { noopLogger } from '../tools/types';
import { chunkText } from './chunking';
import type { EmbeddingService } from './embedding-service';
import { DocumentExtractionError, extractText, type PdfTextExtractor } from './extract';
import type { PgVectorStore } from './pgvector-store';

/** Minimal read port on object storage (`StorageDriver` satisfies it). */
export interface ObjectReader {
  get(key: string): Promise<Buffer>;
}

export interface DocumentIngestorDeps {
  prisma: PrismaClient;
  storage: ObjectReader;
  embeddings: EmbeddingService;
  store: PgVectorStore;
  logger?: EngineLogger;
  /** PDF text extraction; without it PDFs fail with a clear "not available" error. */
  pdf?: PdfTextExtractor | null;
  /** Chunks embedded (and written) per provider call. */
  embedBatchSize?: number;
  /** Upper bound on chunks per document. */
  maxChunks?: number;
}

export interface IngestRequest {
  organizationId: string;
  documentId: string;
  knowledgeBaseId: string;
  /** 1-based attempt number of the current job and the total allowed (final attempt marks the document failed). */
  attempt: number;
  maxAttempts: number;
}

export type IngestResult =
  | { status: 'ready'; chunkCount: number; pageCount: number | null; embeddingModel: string }
  | { status: 'skipped'; reason: 'not_found' | 'already_ready' | 'claimed_elsewhere' };

/** Raised after the document has been marked `failed`; `permanent` tells the queue not to retry. */
export class DocumentIngestError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DocumentIngestError';
  }
}

const MAX_ERROR_LENGTH = 500;

/** Recompute denormalised counters of a knowledge base from its documents (idempotent). */
export async function refreshKnowledgeBaseCounts(
  prisma: PrismaClient,
  organizationId: string,
  knowledgeBaseId: string,
): Promise<{ documentCount: number; chunkCount: number }> {
  const [documentCount, chunks] = await Promise.all([
    prisma.document.count({ where: { organizationId, knowledgeBaseId } }),
    prisma.document.aggregate({
      where: { organizationId, knowledgeBaseId, status: 'ready' },
      _sum: { chunkCount: true },
    }),
  ]);
  const chunkCount = Number(chunks._sum.chunkCount ?? 0);
  await prisma.knowledgeBase.updateMany({
    where: { id: knowledgeBaseId, organizationId },
    data: { documentCount, chunkCount },
  });
  return { documentCount, chunkCount };
}

/** Markdown-style heading lines with their start offsets, in document order. */
function headingsOf(text: string): Array<{ start: number; title: string }> {
  return [...text.matchAll(/^#{1,6}[ \t]+(.+)$/gm)].map((m) => ({
    start: m.index ?? 0,
    title: (m[1] ?? '').trim().slice(0, 200),
  }));
}

/**
 * The document-processing pipeline shared by the workers' `document-processing` consumer and the
 * integration tests: validate → extract → chunk → store chunks → embed in batches → write vectors →
 * mark the document `ready` (or `failed` with a readable error).
 *
 * Idempotent and retry-safe: a `ready` document is skipped; every run replaces the document's chunks in
 * one transaction before embedding, so a crashed or retried run never leaves duplicates; search only
 * sees chunks of `ready` documents, so half-embedded documents are invisible. Every statement is
 * scoped by `organizationId`.
 */
export class DocumentIngestor {
  private readonly logger: EngineLogger;
  private readonly batchSize: number;
  private readonly maxChunks: number;

  constructor(private readonly deps: DocumentIngestorDeps) {
    this.logger = deps.logger ?? noopLogger;
    this.batchSize = deps.embedBatchSize ?? 32;
    this.maxChunks = deps.maxChunks ?? 5_000;
  }

  async process(request: IngestRequest): Promise<IngestResult> {
    const { prisma } = this.deps;
    const { organizationId, documentId } = request;

    const document = await prisma.document.findFirst({
      where: { id: documentId, organizationId, knowledgeBaseId: request.knowledgeBaseId },
    });
    if (!document) return { status: 'skipped', reason: 'not_found' };
    if (document.status === 'ready') return { status: 'skipped', reason: 'already_ready' };

    const claimed = await prisma.document.updateMany({
      where: {
        id: document.id,
        organizationId,
        status: { in: ['uploaded', 'processing', 'failed'] },
      },
      data: { status: 'processing', error: null },
    });
    if (claimed.count === 0) return { status: 'skipped', reason: 'claimed_elsewhere' };

    try {
      const knowledgeBase = await prisma.knowledgeBase.findFirst({
        where: { id: document.knowledgeBaseId, organizationId },
      });
      if (!knowledgeBase) {
        throw new DocumentIngestError('The knowledge base no longer exists.', true, 'kb_missing');
      }

      let data: Buffer;
      try {
        data = await this.deps.storage.get(document.storageKey);
      } catch (error) {
        throw new DocumentIngestError(
          'The stored file could not be read. Upload the document again.',
          true,
          'storage_missing',
          { cause: error },
        );
      }
      if (data.length === 0) {
        throw new DocumentIngestError('The stored file is empty.', true, 'empty');
      }
      if (document.checksum) {
        if (createHash('sha256').update(data).digest('hex') !== document.checksum) {
          throw new DocumentIngestError(
            'The stored file does not match its checksum.',
            true,
            'checksum_mismatch',
          );
        }
      }

      const extracted = await extractText({
        data,
        mimeType: document.mimeType,
        fileName: document.fileName,
        pdf: this.deps.pdf ?? null,
      });
      const chunks = chunkText(extracted.text);
      if (chunks.length === 0) {
        throw new DocumentExtractionError('empty', 'The document contains no text.');
      }
      if (chunks.length > this.maxChunks) {
        throw new DocumentIngestError(
          `The document is too large to index (${chunks.length} chunks, maximum ${this.maxChunks}).`,
          true,
          'too_many_chunks',
        );
      }

      const headings = headingsOf(extracted.text);
      const rows = chunks.map((chunk) => {
        const page = [...extracted.pages].reverse().find((p) => p.start <= chunk.start)?.page;
        const heading = [...headings].reverse().find((h) => h.start <= chunk.start)?.title;
        return {
          id: randomUUID(),
          organizationId,
          knowledgeBaseId: document.knowledgeBaseId,
          documentId: document.id,
          index: chunk.index,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          metadata: {
            offset: chunk.start,
            ...(page !== undefined ? { page } : {}),
            ...(heading ? { heading } : {}),
          } as Prisma.InputJsonObject,
        };
      });
      // Replace this document's chunks atomically (retry / reprocess safe).
      await prisma.$transaction(async (tx) => {
        await tx.documentChunk.deleteMany({ where: { documentId: document.id, organizationId } });
        for (let i = 0; i < rows.length; i += 500) {
          await tx.documentChunk.createMany({ data: rows.slice(i, i + 500) });
        }
      });

      let embeddingModel = knowledgeBase.embeddingModel ?? '';
      let providerConfigId: string | null = knowledgeBase.embeddingProviderConfigId;
      for (let i = 0; i < rows.length; i += this.batchSize) {
        const batch = rows.slice(i, i + this.batchSize);
        const embedded = await this.deps.embeddings.embedTexts(
          organizationId,
          batch.map((row) => row.content),
          {
            configId: knowledgeBase.embeddingProviderConfigId,
            model: knowledgeBase.embeddingModel,
            userId: document.uploadedById,
            metadata: { purpose: 'document_ingest', documentId: document.id },
          },
        );
        embeddingModel = embedded.model;
        providerConfigId = embedded.providerConfigId;
        if (embedded.vectors.length !== batch.length) {
          throw new DocumentIngestError(
            'The embedding provider returned an unexpected number of vectors.',
            false,
            'embedding_mismatch',
          );
        }
        await this.deps.store.setEmbeddings(
          organizationId,
          batch.map((row, j) => ({
            chunkId: row.id,
            embedding: embedded.vectors[j] as number[],
          })),
        );
      }

      const embeddedCount = await this.deps.store.embeddedCount(organizationId, document.id);
      if (embeddedCount !== rows.length) {
        throw new DocumentIngestError(
          `Only ${embeddedCount} of ${rows.length} chunks were embedded.`,
          false,
          'embedding_incomplete',
        );
      }

      const previousMetadata = (document.metadata ?? {}) as Record<string, unknown>;
      await prisma.document.updateMany({
        where: { id: document.id, organizationId },
        data: {
          status: 'ready',
          error: null,
          chunkCount: rows.length,
          pageCount: extracted.pageCount,
          processedAt: new Date(),
          metadata: {
            ...previousMetadata,
            embedding: { model: embeddingModel, providerConfigId },
          } as Prisma.InputJsonObject,
        },
      });
      await refreshKnowledgeBaseCounts(prisma, organizationId, document.knowledgeBaseId);
      this.logger.info(
        { organizationId, documentId: document.id, chunks: rows.length },
        'document processed',
      );
      return {
        status: 'ready',
        chunkCount: rows.length,
        pageCount: extracted.pageCount,
        embeddingModel,
      };
    } catch (error) {
      throw await this.handleFailure(request, document.knowledgeBaseId, error);
    }
  }

  /** Classifies the failure; marks the document `failed` when it is permanent or the final attempt. */
  private async handleFailure(
    request: IngestRequest,
    knowledgeBaseId: string,
    error: unknown,
  ): Promise<DocumentIngestError> {
    const { prisma } = this.deps;
    const classified = classify(error);
    const finalAttempt = request.attempt >= request.maxAttempts;
    if (classified.permanent || finalAttempt) {
      try {
        await prisma.documentChunk.deleteMany({
          where: { documentId: request.documentId, organizationId: request.organizationId },
        });
        await prisma.document.updateMany({
          where: { id: request.documentId, organizationId: request.organizationId },
          data: {
            status: 'failed',
            error: classified.message.slice(0, MAX_ERROR_LENGTH),
            chunkCount: 0,
            processedAt: new Date(),
          },
        });
        await refreshKnowledgeBaseCounts(prisma, request.organizationId, knowledgeBaseId);
      } catch (writeError) {
        this.logger.error(
          { err: writeError, documentId: request.documentId },
          'could not mark document as failed',
        );
      }
    }
    this.logger.warn(
      {
        organizationId: request.organizationId,
        documentId: request.documentId,
        code: classified.code,
        permanent: classified.permanent,
        attempt: request.attempt,
        maxAttempts: request.maxAttempts,
        reason: classified.message,
      },
      'document processing failed',
    );
    return new DocumentIngestError(
      classified.message,
      classified.permanent || finalAttempt,
      classified.code,
      { cause: error },
    );
  }
}

function classify(error: unknown): { message: string; code: string; permanent: boolean } {
  if (error instanceof DocumentIngestError) {
    return { message: error.message, code: error.code, permanent: error.permanent };
  }
  if (error instanceof DocumentExtractionError) {
    return { message: error.message, code: error.code, permanent: true };
  }
  if (error instanceof AiNotConfiguredError) {
    return {
      message: `Embeddings are not configured: ${error.message}`,
      code: 'ai_not_configured',
      permanent: true,
    };
  }
  if (error instanceof AiProviderError) {
    return {
      message: `The embedding provider failed (${error.code}): ${error.message}`,
      code: `provider_${error.code}`,
      permanent: !error.retryable,
    };
  }
  return {
    message: error instanceof Error ? `Processing error: ${error.message}` : 'Processing error',
    code: 'unexpected',
    permanent: false,
  };
}
