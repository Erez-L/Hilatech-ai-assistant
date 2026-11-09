/**
 * Jest `setupFiles` entry for integration tests. Runs before any module is imported so the
 * environment the workers validate at boot already points at the test database and an isolated
 * BullMQ prefix. The root `.env` is still loaded by ConfigModule for anything not set here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readRootEnv(): Record<string, string> {
  const file = resolve(__dirname, '..', '..', '..', '.env');
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2]!.replace(/\s+#.*$/, '');
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    out[match[1]!] = value;
  }
  return out;
}

const rootEnv = readRootEnv();

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base =
    process.env.DATABASE_URL ??
    rootEnv.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/hilatech?schema=public';
  const url = new URL(base);
  if (!url.pathname.endsWith('_test')) url.pathname = `${url.pathname}_test`;
  return url.toString();
}

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.WORKERS_TEST_LOG_LEVEL ?? 'warn';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.REDIS_URL = process.env.REDIS_URL ?? rootEnv.REDIS_URL ?? 'redis://localhost:6379';
process.env.BULLMQ_PREFIX = 'hta-test';
process.env.EMAIL_DRIVER = 'log';
process.env.WORKERS_HEALTH_PORT = '0';
process.env.WORKER_CONCURRENCY = '2';
process.env.APP_URL = 'http://localhost:3000';
