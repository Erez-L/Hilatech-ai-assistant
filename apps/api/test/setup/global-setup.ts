import './env';

import { ALL_PERMISSIONS } from '@hilatech/contracts';
import { createPrismaClient } from '@hilatech/database';
import Redis from 'ioredis';

/**
 * Runs once per jest invocation: verifies the test database is migrated, truncates data tables, seeds the
 * Permission catalog (CI runs the real seed; locally the test DB may be empty) and clears test queues.
 */
export default async function globalSetup(): Promise<void> {
  const prisma = createPrismaClient({
    connectionString: process.env.DATABASE_URL,
    maxConnections: 2,
  });
  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    const tables = rows.map((r) => r.table_name);
    if (!tables.includes('User') || !tables.includes('_prisma_migrations')) {
      throw new Error(
        `Test database is not migrated (${process.env.DATABASE_URL}). Run the migrations first.`,
      );
    }
    const dataTables = tables.filter((t) => t !== '_prisma_migrations' && t !== 'Permission');
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${dataTables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
    for (const key of ALL_PERMISSIONS) {
      const group = key.split(':')[0] ?? 'misc';
      await prisma.permission.upsert({ where: { key }, update: { group }, create: { key, group } });
    }
  } finally {
    await prisma.$disconnect();
  }

  const redis = new Redis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    const prefix = process.env.BULLMQ_PREFIX as string;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch (error) {
    console.warn(`Could not clean test queues in Redis (${(error as Error).message}); continuing.`);
  } finally {
    redis.disconnect();
  }
}
