import type { JOB_SCHEMAS, QueueName } from '@hilatech/contracts';
import type { Job } from 'bullmq';
import type { z } from 'zod';

/** Validated payload type for a queue, derived from the shared contract schema. */
export type JobPayload<Q extends QueueName> = z.infer<(typeof JOB_SCHEMAS)[Q]>;

/** Structured fields attached to every log line emitted while a job runs. */
export interface JobContext {
  queue: QueueName;
  jobId: string | undefined;
  jobName: string;
  attempt: number;
  maxAttempts: number | undefined;
  organizationId: string | null;
  idempotencyKey: string;
  requestId: string | undefined;
}

/**
 * What a processor returns. `completed` means real work happened; `skipped` means the job was
 * intentionally not performed (duplicate, or the capability is not implemented yet) — never an error.
 */
export type JobOutcome =
  | ({ status: 'completed' } & Record<string, unknown>)
  | ({ status: 'skipped'; reason: 'not_implemented' | 'duplicate' | string } & Record<string, unknown>);

export interface JobProcessor<Q extends QueueName = QueueName> {
  readonly queue: Q;
  /**
   * `job.data` has already been validated against `JOB_SCHEMAS[queue]` (defaults applied) when this is
   * called. Throw `UnrecoverableError` for permanent failures, any other error to let BullMQ retry
   * with the producer's backoff settings.
   */
  process(job: Job<JobPayload<Q>>, context: JobContext): Promise<JobOutcome>;
}

/** Injection token for the array of all processors (one per queue). */
export const JOB_PROCESSORS = Symbol('JOB_PROCESSORS');

export type AnyJobProcessor = { [Q in QueueName]: JobProcessor<Q> }[QueueName];
