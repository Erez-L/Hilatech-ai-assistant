import { type PrismaClient, createPrismaClient } from '@hilatech/database';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { AppConfig } from '../../config/app-config.service';

/**
 * Thin lifecycle wrapper around the shared Prisma client from `@hilatech/database`.
 * Exposes the client as `prisma.client` to keep a single, explicit access point for queries.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(config: AppConfig) {
    this.client = createPrismaClient({
      connectionString: config.get('DATABASE_URL'),
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** Liveness probe used by the readiness endpoint. */
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }
}
