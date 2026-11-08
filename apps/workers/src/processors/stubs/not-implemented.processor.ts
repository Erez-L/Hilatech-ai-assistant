import { Injectable } from '@nestjs/common';
import { QueueName } from '@hilatech/contracts';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from '../../queue/job-processor';

/** The outcome every not-yet-implemented processor returns. */
export const NOT_IMPLEMENTED_OUTCOME = { status: 'skipped', reason: 'not_implemented' } as const satisfies JobOutcome;

/**
 * Base for queues whose consumer logic does not exist yet (Priorities 3+). The job is validated,
 * logged at warn level and completed with `{ status: 'skipped', reason: 'not_implemented' }` — it is
 * not failed (so queues do not fill with retries) and nothing pretends work happened.
 */
export abstract class NotImplementedProcessor<Q extends QueueName> implements JobProcessor<Q> {
  abstract readonly queue: Q;
  /** Short description of what the real implementation will do, for the log line. */
  protected abstract readonly plannedWork: string;

  protected constructor(protected readonly logger: PinoLogger) {}

  async process(_job: Job<JobPayload<Q>>, context: JobContext): Promise<JobOutcome> {
    this.logger.warn({ ...context, plannedWork: this.plannedWork }, 'Processor not implemented yet; job skipped (no work performed)');
    return { ...NOT_IMPLEMENTED_OUTCOME, plannedWork: this.plannedWork };
  }
}

@Injectable()
export class DocumentProcessingProcessor extends NotImplementedProcessor<typeof QueueName.DOCUMENT_PROCESSING> {
  readonly queue = QueueName.DOCUMENT_PROCESSING;
  protected readonly plannedWork = 'extract text, chunk the document and enqueue embeddings (Knowledge priority)';
  constructor(@InjectPinoLogger(DocumentProcessingProcessor.name) logger: PinoLogger) {
    super(logger);
  }
}

@Injectable()
export class EmbeddingsProcessor extends NotImplementedProcessor<typeof QueueName.EMBEDDINGS> {
  readonly queue = QueueName.EMBEDDINGS;
  protected readonly plannedWork = 'compute embeddings for document chunks via the AiProvider (Knowledge priority)';
  constructor(@InjectPinoLogger(EmbeddingsProcessor.name) logger: PinoLogger) {
    super(logger);
  }
}

@Injectable()
export class AiTasksProcessor extends NotImplementedProcessor<typeof QueueName.AI_TASKS> {
  readonly queue = QueueName.AI_TASKS;
  protected readonly plannedWork = 'conversation summaries, agent executions and lead enrichment through the AI engine (AI priority)';
  constructor(@InjectPinoLogger(AiTasksProcessor.name) logger: PinoLogger) {
    super(logger);
  }
}

@Injectable()
export class AutomationProcessor extends NotImplementedProcessor<typeof QueueName.AUTOMATION> {
  readonly queue = QueueName.AUTOMATION;
  protected readonly plannedWork = 'run workflow executions and n8n hand-offs (Automation priority)';
  constructor(@InjectPinoLogger(AutomationProcessor.name) logger: PinoLogger) {
    super(logger);
  }
}

@Injectable()
export class WebhookDeliveryProcessor extends NotImplementedProcessor<typeof QueueName.WEBHOOK_DELIVERY> {
  readonly queue = QueueName.WEBHOOK_DELIVERY;
  protected readonly plannedWork = 'signed HTTP delivery to organization webhook endpoints with per-endpoint retry policy (Automation priority)';
  constructor(@InjectPinoLogger(WebhookDeliveryProcessor.name) logger: PinoLogger) {
    super(logger);
  }
}
