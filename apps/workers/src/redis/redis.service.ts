import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import IORedis, { type RedisOptions } from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { withTimeout } from '../common/with-timeout';

/**
 * Translate `REDIS_URL` into ioredis options. BullMQ requires `maxRetriesPerRequest: null` on the
 * connections it owns (blocking commands must not be retried/failed by ioredis).
 */
export function parseRedisUrl(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis URL protocol "${url.protocol}" (expected redis:// or rediss://)`);
  }
  const options: RedisOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  const db = url.pathname.replace(/^\//, '');
  if (db) options.db = Number(db);
  if (url.protocol === 'rediss:') options.tls = {};
  return options;
}

/**
 * Owns the shared connection options handed to every BullMQ `Worker`/`Queue`/`QueueEvents` (BullMQ
 * creates its own connections from them) and one dedicated client used only for health pings.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly connectionOptions: RedisOptions;
  private readonly pingClient: IORedis;
  private lastErrorLoggedAt = 0;

  constructor(
    @Inject(WORKERS_ENV) env: WorkersEnv,
    @InjectPinoLogger(RedisService.name) private readonly logger: PinoLogger,
  ) {
    this.connectionOptions = parseRedisUrl(env.REDIS_URL);
    this.pingClient = new IORedis({
      ...this.connectionOptions,
      // Health probe must answer quickly: never queue commands while disconnected.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
      retryStrategy: (times) => Math.min(times * 500, 5_000),
      connectionName: 'hta-workers-health',
    });
    this.pingClient.on('error', (err: Error) => {
      // ioredis emits an error on every failed reconnect attempt; keep the log readable.
      const now = Date.now();
      if (now - this.lastErrorLoggedAt > 10_000) {
        this.lastErrorLoggedAt = now;
        this.logger.warn({ err: { message: err.message } }, 'Redis health client error');
      }
    });
  }

  /** `true` when PING answers within `timeoutMs`. */
  async ping(timeoutMs = 2_000): Promise<boolean> {
    try {
      const reply = await withTimeout(this.pingClient.ping(), timeoutMs, 'redis ping');
      return reply === 'PONG';
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await withTimeout(this.pingClient.quit(), 2_000, 'redis quit');
    } catch {
      this.pingClient.disconnect();
    }
  }
}
