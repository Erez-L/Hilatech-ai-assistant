import { ALL_PERMISSIONS } from '@hilatech/contracts';
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
      maxConnections: config.get('DB_POOL_MAX'),
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    await this.syncPermissionCatalog();
  }

  /**
   * Keeps the `Permission` catalog equal to the keys in `@hilatech/contracts` on every start, so a
   * deployed environment needs no separate seed step (and picks up keys added by a new release).
   * Idempotent and safe with several API instances starting together. Never removes rows.
   */
  private async syncPermissionCatalog(): Promise<void> {
    await this.client.permission.createMany({
      data: ALL_PERMISSIONS.map((key) => ({ key, group: key.split(':')[0] ?? 'misc' })),
      skipDuplicates: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** Liveness probe used by the readiness endpoint. */
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }
}
