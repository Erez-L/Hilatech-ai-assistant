import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { AppConfig } from '../../config/app-config.service';
import { redisOptionsFromUrl } from './redis.util';

/** A single ioredis connection for health checks and lightweight platform needs (BullMQ manages its own). */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: AppConfig) {
    this.client = new Redis(
      redisOptionsFromUrl(config.get('REDIS_URL'), {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
      }),
    );
    // Avoid unhandled 'error' events crashing the process when Redis is unreachable; health reports it.
    this.client.on('error', () => undefined);
  }

  /** Round-trip check used by the readiness probe. Throws when Redis is unreachable. */
  async ping(): Promise<string> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
    return this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') {
      await this.client.quit().catch(() => this.client.disconnect());
    }
  }
}
