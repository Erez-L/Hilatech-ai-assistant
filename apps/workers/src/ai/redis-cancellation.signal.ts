import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { CancellationSignal } from '@hilatech/ai-engine';
import IORedis from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { withTimeout } from '../common/with-timeout';
import { RedisService } from '../redis/redis.service';

/**
 * Key the API writes when a user cancels an execution (`POST /agents/executions/:id/cancel`). The
 * prefix is literal and independent of `BULLMQ_PREFIX` so both processes agree on it.
 */
export const EXECUTION_CANCEL_KEY_PREFIX = 'hta:exec:cancel:';

export function executionCancelKey(executionId: string): string {
  return `${EXECUTION_CANCEL_KEY_PREFIX}${executionId}`;
}

/**
 * Cooperative cancellation for agent runs: the runner polls `isCancelled()` between steps and ends
 * the execution as `cancelled` when the key exists. Redis problems fail **open** (the run continues)
 * — a cancellation that cannot be read must not turn a healthy run into a failed one; the duration
 * limit still bounds it.
 */
@Injectable()
export class RedisCancellationSignal implements CancellationSignal, OnApplicationShutdown {
  private readonly client: IORedis;
  private lastErrorLoggedAt = 0;

  constructor(
    redis: RedisService,
    @InjectPinoLogger(RedisCancellationSignal.name) private readonly logger: PinoLogger,
  ) {
    this.client = new IORedis({
      ...redis.connectionOptions,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
      retryStrategy: (times) => Math.min(times * 500, 5_000),
      connectionName: 'hta-workers-exec-cancel',
    });
    this.client.on('error', (err: Error) => {
      const now = Date.now();
      if (now - this.lastErrorLoggedAt > 10_000) {
        this.lastErrorLoggedAt = now;
        this.logger.warn({ err: { message: err.message } }, 'Cancellation Redis client error');
      }
    });
  }

  async isCancelled(executionId: string): Promise<boolean> {
    try {
      const exists = await withTimeout(
        this.client.exists(executionCancelKey(executionId)),
        2_000,
        'cancellation lookup',
      );
      return exists > 0;
    } catch (err) {
      this.logger.warn({ err, executionId }, 'Cancellation lookup failed; assuming not cancelled');
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await withTimeout(this.client.quit(), 2_000, 'redis quit');
    } catch {
      this.client.disconnect();
    }
  }
}
