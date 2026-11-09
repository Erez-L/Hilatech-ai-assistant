import { type CancellationSignal } from '@hilatech/ai-engine';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { RedisService } from '../../../infrastructure/redis/redis.service';

export const CANCEL_KEY_PREFIX = 'hta:exec:cancel:';
export const CANCEL_KEY_TTL_SECONDS = 60 * 60;

export function cancellationKey(executionId: string): string {
  return `${CANCEL_KEY_PREFIX}${executionId}`;
}

/**
 * Cooperative cancellation flag shared by the API (which sets it) and whichever process runs the
 * execution (API in sync mode, workers in async mode — both poll `isCancelled` between steps through
 * `PrismaExecutionStore`). Keys expire after one hour so stale flags never accumulate.
 */
@Injectable()
export class CancellationService implements CancellationSignal {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: Logger,
  ) {}

  async requestCancel(executionId: string): Promise<void> {
    const client = await this.redis.ensureConnected();
    await client.set(cancellationKey(executionId), '1', 'EX', CANCEL_KEY_TTL_SECONDS);
  }

  async isCancelled(executionId: string): Promise<boolean> {
    try {
      const client = await this.redis.ensureConnected();
      return (await client.exists(cancellationKey(executionId))) === 1;
    } catch (error) {
      // Redis trouble must not abort a running execution; it just cannot be cancelled right now.
      this.logger.warn(
        { err: error, executionId },
        'Could not read cancellation flag',
        CancellationService.name,
      );
      return false;
    }
  }

  async clear(executionId: string): Promise<void> {
    try {
      const client = await this.redis.ensureConnected();
      await client.del(cancellationKey(executionId));
    } catch {
      // Best effort: the key expires on its own.
    }
  }
}
