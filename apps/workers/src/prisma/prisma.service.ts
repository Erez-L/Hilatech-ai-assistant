import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@hilatech/database';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKERS_ENV } from '../config/config.module';
import type { WorkersEnv } from '../config/env.schema';
import { withTimeout } from '../common/with-timeout';

/**
 * Thin wrapper around the shared Prisma client (`@hilatech/database`). Processors use `prisma.client`;
 * the wrapper owns the connection lifecycle and the health probe.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnApplicationShutdown {
  readonly client: PrismaClient;

  constructor(
    @Inject(WORKERS_ENV) env: WorkersEnv,
    @InjectPinoLogger(PrismaService.name) private readonly logger: PinoLogger,
  ) {
    this.client = createPrismaClient({
      connectionString: env.DATABASE_URL,
      maxConnections: env.DB_POOL_MAX,
    });
  }

  async onModuleInit(): Promise<void> {
    // Fail fast with a clear message instead of discovering a bad DATABASE_URL inside the first job.
    await this.client.$connect();
    await this.client.$queryRaw`SELECT 1`;
    this.logger.info('Database connection established');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client
      .$disconnect()
      .catch((err: unknown) => this.logger.warn({ err }, 'Prisma disconnect failed'));
  }

  /** `true` when a trivial query succeeds within `timeoutMs`. */
  async ping(timeoutMs = 2_000): Promise<boolean> {
    try {
      await withTimeout(this.client.$queryRaw`SELECT 1`, timeoutMs, 'database ping');
      return true;
    } catch (err) {
      this.logger.warn({ err }, 'Database ping failed');
      return false;
    }
  }
}
