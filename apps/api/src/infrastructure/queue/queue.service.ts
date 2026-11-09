import { DEFAULT_JOB_OPTIONS, JOB_SCHEMAS, type QueueName } from '@hilatech/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { type JobsOptions, type Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { type z } from 'zod';

import { AppException } from '../../common/errors/app.exception';

type JobSchemas = typeof JOB_SCHEMAS;
export type JobPayload<Q extends QueueName> = z.input<JobSchemas[Q]>;
export type ParsedJobPayload<Q extends QueueName> = z.output<JobSchemas[Q]>;

export interface EnqueueResult {
  jobId: string;
  queue: QueueName;
}

/**
 * The only way the API produces background jobs. Every payload is validated against
 * `JOB_SCHEMAS[queue]` and the `idempotencyKey` becomes the BullMQ `jobId`, so duplicate
 * enqueues collapse into a single job.
 */
@Injectable()
export class QueueService {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly logger: Logger,
  ) {}

  async enqueue<Q extends QueueName>(
    queueName: Q,
    payload: JobPayload<Q>,
    options: Omit<JobsOptions, 'jobId'> = {},
  ): Promise<EnqueueResult> {
    const schema = JOB_SCHEMAS[queueName];
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      // A producer bug, never user input: surface loudly.
      throw new Error(
        `Invalid payload for queue "${queueName}": ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
    }
    const data = parsed.data as ParsedJobPayload<Q>;
    const queue = this.getQueue(queueName);
    const job = await queue.add(queueName, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...options,
      jobId: data.idempotencyKey,
    });
    this.logger.debug(
      {
        queue: queueName,
        jobId: job.id,
        organizationId: data.organizationId,
        requestId: data.requestId,
      },
      'Job enqueued',
      QueueService.name,
    );
    return { jobId: String(job.id ?? data.idempotencyKey), queue: queueName };
  }

  getQueue(queueName: QueueName): Queue {
    try {
      return this.moduleRef.get<Queue>(getQueueToken(queueName), { strict: false });
    } catch {
      throw AppException.notFound(`Queue "${queueName}"`);
    }
  }
}
