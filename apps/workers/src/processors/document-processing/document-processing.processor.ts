import { Inject, Injectable } from '@nestjs/common';
import {
  DocumentIngestError,
  DocumentIngestor,
  PgVectorStore,
  type PdfTextExtractor,
} from '@hilatech/ai-engine';
import { QueueName } from '@hilatech/contracts';
import type { StorageDriver } from '@hilatech/storage';
import { UnrecoverableError, type Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AiRuntime } from '../../ai/ai-runtime';
import { toEngineLogger } from '../../ai/engine-logger';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from '../../queue/job-processor';
import { STORAGE_DRIVER } from '../../storage/storage.module';
import { DocumentEvents } from './document-events';
import { loadPdfExtractor } from './pdf-text';

type Payload = JobPayload<typeof QueueName.DOCUMENT_PROCESSING>;

/**
 * `document-processing` consumer: validate → extract → chunk → store chunks → embed in batches → write
 * vectors → `Document.ready` (or `failed` with a readable error). The pipeline itself is the engine's
 * `DocumentIngestor` (shared with the API's integration tests); this class adapts it to BullMQ:
 *  - permanent failures (unsupported/empty/corrupt file, no embedding provider, auth errors) mark the
 *    document `failed` and fail the job with `UnrecoverableError` (no pointless retries);
 *  - transient failures (provider timeouts, rate limits, database blips) rethrow so BullMQ retries with
 *    the producer's backoff; the final attempt marks the document `failed`;
 *  - duplicates (`ready` document, deleted document) complete as `skipped`.
 */
@Injectable()
export class DocumentProcessingProcessor implements JobProcessor<
  typeof QueueName.DOCUMENT_PROCESSING
> {
  readonly queue = QueueName.DOCUMENT_PROCESSING;
  private ingestor: DocumentIngestor | null = null;
  private pdf: Promise<PdfTextExtractor | null> | null = null;

  constructor(
    private readonly runtime: AiRuntime,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly events: DocumentEvents,
    @InjectPinoLogger(DocumentProcessingProcessor.name) private readonly logger: PinoLogger,
  ) {}

  /** Built lazily so the PDF library is only imported when the first job runs. */
  private async getIngestor(): Promise<DocumentIngestor> {
    if (this.ingestor) return this.ingestor;
    this.pdf ??= loadPdfExtractor();
    const pdf = await this.pdf;
    if (!pdf) this.logger.warn('pdf-parse is unavailable; PDF documents will be marked failed');
    this.ingestor = new DocumentIngestor({
      prisma: this.runtime.prisma.client,
      storage: this.storage,
      embeddings: this.runtime.embeddings,
      store: new PgVectorStore(this.runtime.prisma.client),
      pdf,
      logger: toEngineLogger(this.logger),
    });
    return this.ingestor;
  }

  async process(job: Job<Payload>, context: JobContext): Promise<JobOutcome> {
    const { organizationId, documentId, knowledgeBaseId } = job.data;
    const ingestor = await this.getIngestor();
    try {
      // Embedding a document spends AI tokens: refuse it when the organization's hard stop is reached.
      const budget = await this.runtime.checkBudget(organizationId);
      if (budget.blocked) {
        const pending = await this.runtime.prisma.client.document.updateMany({
          where: { id: documentId, organizationId, status: { not: 'ready' } },
          data: { status: 'failed', error: budget.message },
        });
        if (pending.count === 0) return { status: 'skipped', reason: 'duplicate' };
        throw new DocumentIngestError(budget.message, true, 'budget_exceeded');
      }
      const result = await ingestor.process({
        organizationId,
        documentId,
        knowledgeBaseId,
        attempt: context.attempt,
        maxAttempts: context.maxAttempts ?? 1,
      });
      if (result.status === 'skipped') {
        return {
          status: 'skipped',
          reason: result.reason === 'already_ready' ? 'duplicate' : result.reason,
        };
      }
      const document = await this.runtime.prisma.client.document.findFirst({
        where: { id: documentId, organizationId },
        select: { title: true, fileName: true, uploadedById: true },
      });
      await this.events.emit(
        organizationId,
        'document.processed',
        {
          documentId,
          knowledgeBaseId,
          title: document?.title ?? null,
          fileName: document?.fileName ?? null,
          chunkCount: result.chunkCount,
          pageCount: result.pageCount,
        },
        { actorUserId: document?.uploadedById, requestId: context.requestId },
      );
      return {
        status: 'completed',
        documentId,
        chunkCount: result.chunkCount,
        pageCount: result.pageCount,
        embeddingModel: result.embeddingModel,
      };
    } catch (error) {
      if (error instanceof DocumentIngestError && error.permanent) {
        const document = await this.runtime.prisma.client.document.findFirst({
          where: { id: documentId, organizationId },
          select: { title: true, fileName: true, uploadedById: true },
        });
        await this.events.emit(
          organizationId,
          'document.failed',
          {
            documentId,
            knowledgeBaseId,
            title: document?.title ?? null,
            fileName: document?.fileName ?? null,
            error: error.message,
            code: error.code,
          },
          { actorUserId: document?.uploadedById, requestId: context.requestId },
        );
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }
}
