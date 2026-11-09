import { JOB_SCHEMAS, type QueueName } from '@hilatech/contracts';
import { UnrecoverableError, type Job } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import type { ZodIssue } from 'zod';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from './job-processor';

export type JobHandler = (job: Job) => Promise<JobOutcome>;

function summariseIssues(issues: ZodIssue[]): string {
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Wraps a processor into the function handed to a BullMQ `Worker`:
 *  1. re-validates `job.data` with the shared contract schema — an invalid payload is a producer bug,
 *     so it is logged with the zod issues and rejected with `UnrecoverableError` (no retries);
 *  2. replaces `job.data` with the parsed value (defaults applied) and runs the processor;
 *  3. emits structured start/complete/fail log lines with jobId, queue, organizationId,
 *     idempotencyKey, attempt and duration. Retries/backoff are driven entirely by the job options the
 *     producer set (`DEFAULT_JOB_OPTIONS`); the worker never overrides them.
 */
export function createJobHandler<Q extends QueueName>(
  queue: Q,
  processor: JobProcessor<Q>,
  logger: PinoLogger,
): JobHandler {
  const schema = JOB_SCHEMAS[queue];

  return async (job: Job): Promise<JobOutcome> => {
    const startedAt = Date.now();
    const attempt = job.attemptsStarted > 0 ? job.attemptsStarted : job.attemptsMade + 1;
    const base = {
      queue,
      jobId: job.id,
      jobName: job.name,
      attempt,
      maxAttempts: job.opts.attempts,
    };

    const parsed = schema.safeParse(job.data);
    if (!parsed.success) {
      logger.error(
        { ...base, issues: parsed.error.issues },
        'Invalid job payload; discarding job without retry',
      );
      throw new UnrecoverableError(
        `Invalid payload for queue "${queue}": ${summariseIssues(parsed.error.issues)}`,
      );
    }

    const data = parsed.data as JobPayload<Q>;
    const context: JobContext = {
      ...base,
      organizationId: data.organizationId,
      idempotencyKey: data.idempotencyKey,
      requestId: data.requestId,
    };
    logger.info(context, 'Job started');

    // Hand the validated payload (with schema defaults) to the processor through the standard API.
    (job as Job<JobPayload<Q>>).data = data;

    try {
      const outcome = await processor.process(job as Job<JobPayload<Q>>, context);
      const durationMs = Date.now() - startedAt;
      const line = {
        ...context,
        durationMs,
        outcome: outcome.status,
        reason: 'reason' in outcome ? outcome.reason : undefined,
      };
      if (outcome.status === 'skipped') logger.warn(line, 'Job skipped');
      else logger.info(line, 'Job completed');
      return outcome;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const unrecoverable = err instanceof UnrecoverableError;
      const willRetry = !unrecoverable && attempt < (job.opts.attempts ?? 1);
      logger.error({ ...context, durationMs, err, unrecoverable, willRetry }, 'Job failed');
      throw err;
    }
  };
}
