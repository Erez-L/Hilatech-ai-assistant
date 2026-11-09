import { Injectable } from '@nestjs/common';
import { QueueName } from '@hilatech/contracts';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from '../../queue/job-processor';

/** The outcome every not-yet-implemented processor returns. */
export const NOT_IMPLEMENTED_OUTCOME = {
  status: 'skipped',
  reason: 'not_implemented',
} as const satisfies JobOutcome;

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
    this.logger.warn(
      { ...context, plannedWork: this.plannedWork },
      'Processor not implemented yet; job skipped (no work performed)',
    );
    return { ...NOT_IMPLEMENTED_OUTCOME, plannedWork: this.plannedWork };
  }
}

@Injectable()
export class EmbeddingsProcessor extends NotImplementedProcessor<typeof QueueName.EMBEDDINGS> {
  readonly queue = QueueName.EMBEDDINGS;
  protected readonly plannedWork =
    'compute embeddings for document chunks via the AiProvider (Knowledge priority)';
  constructor(@InjectPinoLogger(EmbeddingsProcessor.name) logger: PinoLogger) {
    super(logger);
  }
}
