/**
 * Jest `setupFiles`: runs in every test worker BEFORE the app (and Nest's ConfigModule) loads.
 * Forces the integration database/redis and quiet, deterministic settings.
 */
const DEFAULT_TEST_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/hilatech_test?schema=public';
const DEFAULT_REDIS_URL = 'redis://localhost:6379';

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
const dbName = (() => {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DATABASE !== 'true') {
  throw new Error(
    `Refusing to run integration tests against database "${dbName}" (${databaseUrl}). ` +
      'Integration tests truncate tables. Point TEST_DATABASE_URL at a database whose name contains "test", ' +
      'or set ALLOW_NON_TEST_DATABASE=true if you really mean it.',
  );
}

/** Use Redis logical database 1 for tests unless an explicit TEST_REDIS_URL is given. */
function testRedisUrl(): string {
  if (process.env.TEST_REDIS_URL) return process.env.TEST_REDIS_URL;
  const url = new URL(process.env.REDIS_URL ?? DEFAULT_REDIS_URL);
  if (!url.pathname || url.pathname === '/') url.pathname = '/1';
  return url.toString();
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = testRedisUrl();
process.env.BULLMQ_PREFIX = process.env.TEST_BULLMQ_PREFIX ?? 'bull-test';
process.env.LOG_LEVEL = 'silent';
process.env.EMAIL_DRIVER = 'log';
process.env.SWAGGER_ENABLED = 'false';
process.env.RATE_LIMIT_MAX = process.env.TEST_RATE_LIMIT_MAX ?? '100000';
process.env.AUTH_RATE_LIMIT_MAX = process.env.TEST_AUTH_RATE_LIMIT_MAX ?? '100000';
process.env.JWT_ACCESS_SECRET ??= 'integration-test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'integration-test-refresh-secret-0123456789abcdef';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.CORS_ORIGINS ??= 'http://localhost:3000';
// AI platform: the deterministic mock provider drives the assistant/agent tests; keys are encrypted
// with a fixed 32-byte test key unless the environment already provides one.
process.env.AI_ALLOW_MOCK_PROVIDER = 'true';
process.env.CREDENTIALS_ENCRYPTION_KEY ??= Buffer.from('integration-test-encryption-key!').toString(
  'base64',
);
process.env.AI_PRICING_JSON ??= '';
