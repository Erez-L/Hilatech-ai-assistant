import { QueueName } from '@hilatech/contracts';

export interface WorkerSettings {
  /** Parallel jobs this process runs for the queue. */
  concurrency: number;
  /** How long a job may run before another worker may consider it stalled (ms). Renewed at half-life. */
  lockDuration: number;
  /** How often the stalled-job check runs (ms). */
  stalledInterval: number;
  /** How many times a job may be recovered from a stall before it is failed. */
  maxStalledCount: number;
}

const MINUTE = 60_000;

/**
 * Per-queue worker tuning. Only execution settings live here — retry counts and backoff are job
 * options chosen by the producer (`DEFAULT_JOB_OPTIONS` in contracts) and are deliberately not set
 * on the worker side.
 */
export function resolveWorkerSettings(queue: QueueName, baseConcurrency: number): WorkerSettings {
  const heavy = Math.max(1, Math.ceil(baseConcurrency / 2));
  const defaults: WorkerSettings = { concurrency: baseConcurrency, lockDuration: 30_000, stalledInterval: 30_000, maxStalledCount: 1 };

  switch (queue) {
    case QueueName.AI_TASKS:
      // LLM calls and agent runs legitimately take minutes.
      return { ...defaults, concurrency: heavy, lockDuration: 5 * MINUTE };
    case QueueName.DOCUMENT_PROCESSING:
    case QueueName.EMBEDDINGS:
      return { ...defaults, concurrency: heavy, lockDuration: 2 * MINUTE };
    case QueueName.AUTOMATION:
      return { ...defaults, lockDuration: 2 * MINUTE };
    case QueueName.ANALYTICS:
      // Rollups are batch-y and rarely parallel.
      return { ...defaults, concurrency: 1, lockDuration: 5 * MINUTE };
    case QueueName.WEBHOOK_DELIVERY:
    case QueueName.EMAIL:
    case QueueName.NOTIFICATIONS:
      return defaults;
    default: {
      const exhaustive: never = queue;
      return exhaustive;
    }
  }
}
