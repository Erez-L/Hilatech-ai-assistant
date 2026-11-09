import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { DEFAULT_JOB_OPTIONS, JOB_SCHEMAS, type QueueName } from '@hilatech/contracts';
import { Queue, type JobsOptions } from 'bullmq';
import type { z } from 'zod';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { RedisService } from '../redis/redis.service';

export type ProducerPayload<Q extends QueueName> = z.input<(typeof JOB_SCHEMAS)[Q]>;

/**
 * Producer side for jobs the workers themselves create (event fan-out → executions and deliveries, delay
 * resumes, webhook retries, agent runs). Payloads are validated against the shared `JOB_SCHEMAS` and the
 * `idempotencyKey` is the BullMQ job id, exactly like the API's `QueueService`.
 */
@Injectable()
export class QueueProducer implements OnApplicationShutdown {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    @Inject(WORKERS_ENV) private readonly env: WorkersEnv,
    private readonly redis: RedisService,
  ) {}

  async enqueue<Q extends QueueName>(
    queueName: Q,
    payload: ProducerPayload<Q>,
    options: Omit<JobsOptions, 'jobId'> = {},
  ): Promise<string> {
    const parsed = JOB_SCHEMAS[queueName].safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `Invalid payload for queue "${queueName}": ${parsed.error.issues
          .map((i) => `${i.path.join('.')} ${i.message}`)
          .join('; ')}`,
      );
    }
    const data = parsed.data as { idempotencyKey: string };
    const job = await this.queue(queueName).add(queueName, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...options,
      jobId: data.idempotencyKey,
    });
    return String(job.id ?? data.idempotencyKey);
  }

  queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: { ...this.redis.connectionOptions },
        prefix: this.env.BULLMQ_PREFIX,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }
}
