import { DEV_JWT_ACCESS_SECRET, validateEnv } from './env.schema';

const minimal = { DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/hilatech_test' };

describe('env schema', () => {
  it('applies development defaults and derives durations', () => {
    const env = validateEnv({ ...minimal });
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.JWT_ACCESS_SECRET).toBe(DEV_JWT_ACCESS_SECRET);
    expect(env.accessTtlMs).toBe(15 * 60_000);
    expect(env.refreshTtlMs).toBe(30 * 86_400_000);
    expect(env.swaggerEnabled).toBe(true);
    expect(env.BULLMQ_PREFIX).toBe('bull');
  });

  it('strips inline comments from values (EMAIL_DRIVER=log  # log | smtp)', () => {
    const env = validateEnv({
      ...minimal,
      EMAIL_DRIVER: 'log            # log | smtp',
      STORAGE_DRIVER: 'local        # local | s3',
    });
    expect(env.EMAIL_DRIVER).toBe('log');
    expect(env.STORAGE_DRIVER).toBe('local');
  });

  it('parses comma-separated CORS origins and booleans', () => {
    const env = validateEnv({
      ...minimal,
      CORS_ORIGINS: 'https://a.example, https://b.example',
      COOKIE_SECURE: 'true',
      SWAGGER_ENABLED: '1',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it('fails hard in production with placeholder or short JWT secrets', () => {
    const prod = { ...minimal, NODE_ENV: 'production', COOKIE_SECURE: 'true' };
    expect(() => validateEnv({ ...prod })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() =>
      validateEnv({
        ...prod,
        JWT_ACCESS_SECRET: 'change-me-access-secret-at-least-32-characters-long',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret-at-least-32-characters-long',
      }),
    ).toThrow(/placeholder/);
    expect(() =>
      validateEnv({ ...prod, JWT_ACCESS_SECRET: 'short', JWT_REFRESH_SECRET: 'short' }),
    ).toThrow(/32 characters/);
    expect(() =>
      validateEnv({
        ...prod,
        JWT_ACCESS_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'a'.repeat(40),
      }),
    ).toThrow(/differ/);
  });

  it('accepts strong production secrets and disables Swagger by default there', () => {
    const env = validateEnv({
      ...minimal,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      JWT_ACCESS_SECRET: 'x'.repeat(48),
      JWT_REFRESH_SECRET: 'y'.repeat(48),
    });
    expect(env.swaggerEnabled).toBe(false);
    expect(env.isProduction).toBe(true);
  });

  it('defaults the AI variables and never allows the mock provider in production', () => {
    const dev = validateEnv({ ...minimal, AI_ALLOW_MOCK_PROVIDER: 'true' });
    expect(dev.AI_ALLOW_MOCK_PROVIDER).toBe(true);
    expect(dev.AI_TOOL_TIMEOUT_MS).toBe(15_000);
    expect(dev.AI_PROVIDER_TIMEOUT_MS).toBe(60_000);
    expect(dev.AI_PRICING_JSON).toBeUndefined();

    const prod = validateEnv({
      ...minimal,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      JWT_ACCESS_SECRET: 'x'.repeat(48),
      JWT_REFRESH_SECRET: 'y'.repeat(48),
      AI_ALLOW_MOCK_PROVIDER: 'true',
      AI_PRICING_JSON:
        '[{"provider":"openai","model":"gpt-4o-mini","inputPerMillionUsd":0.15,"outputPerMillionUsd":0.6}]',
    });
    expect(prod.AI_ALLOW_MOCK_PROVIDER).toBe(false);
    expect(prod.AI_PRICING_JSON).toContain('gpt-4o-mini');
  });

  it('requires SMTP_HOST for the smtp driver and validates durations', () => {
    expect(() => validateEnv({ ...minimal, EMAIL_DRIVER: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(() => validateEnv({ ...minimal, JWT_ACCESS_TTL: 'soon' })).toThrow(/duration/);
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});
