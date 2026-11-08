/**
 * Shared Prisma client for the API and workers.
 *
 * Prisma 7 generates a TypeScript client (into `src/generated`) that connects through a driver adapter.
 * Both apps import `PrismaClient`, `Prisma`, enums and model types from this package so there is exactly
 * one schema and one generated client.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export * from './generated/client';
export { PrismaClient };

export interface CreatePrismaClientOptions {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  connectionString?: string;
  /** Prisma log levels. Defaults to warnings and errors. */
  log?: Array<'query' | 'info' | 'warn' | 'error'>;
  /** pg pool size. */
  maxConnections?: number;
}

/** Create a PrismaClient wired to PostgreSQL through the `pg` driver adapter. */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const adapter = new PrismaPg({ connectionString, max: options.maxConnections ?? 10 });
  return new PrismaClient({ adapter, log: options.log ?? ['warn', 'error'] });
}
