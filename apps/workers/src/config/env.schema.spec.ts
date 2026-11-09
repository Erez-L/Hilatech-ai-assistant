import { validateEnv } from './env.schema';

const minimal = {
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
};

describe('validateEnv', () => {
  it('applies defaults and coerces numbers', () => {
    const env = validateEnv({
      ...minimal,
      WORKERS_HEALTH_PORT: '4101',
      SMTP_HOST: '',
      SMTP_PORT: '',
    });
    expect(env.WORKERS_HEALTH_PORT).toBe(4101);
    expect(env.WORKER_CONCURRENCY).toBe(5);
    expect(env.EMAIL_DRIVER).toBe('log');
    expect(env.BULLMQ_PREFIX).toBe('bull');
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.SMTP_PORT).toBe(587);
    expect(env.SMTP_SECURE).toBe(false);
  });

  it('lists every missing required variable', () => {
    expect(() => validateEnv({})).toThrow(/REDIS_URL[\s\S]*DATABASE_URL/);
  });

  it('requires SMTP_HOST when EMAIL_DRIVER=smtp', () => {
    expect(() => validateEnv({ ...minimal, EMAIL_DRIVER: 'smtp' })).toThrow(
      /SMTP_HOST is required/,
    );
    expect(() =>
      validateEnv({
        ...minimal,
        EMAIL_DRIVER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'u',
      }),
    ).toThrow(/SMTP_USER and SMTP_PASSWORD/);
    const ok = validateEnv({
      ...minimal,
      EMAIL_DRIVER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      SMTP_SECURE: 'true',
    });
    expect(ok.SMTP_SECURE).toBe(true);
  });

  it('rejects an unknown EMAIL_DRIVER', () => {
    expect(() => validateEnv({ ...minimal, EMAIL_DRIVER: 'sendgrid' })).toThrow(/EMAIL_DRIVER/);
  });

  it('applies AI engine defaults and normalises empty values', () => {
    const env = validateEnv({
      ...minimal,
      CREDENTIALS_ENCRYPTION_KEY: '',
      AI_PRICING_JSON: '',
      AI_TOOL_TIMEOUT_MS: '',
    });
    expect(env.CREDENTIALS_ENCRYPTION_KEY).toBeUndefined();
    expect(env.AI_ALLOW_MOCK_PROVIDER).toBe(false);
    expect(env.AI_PRICING_JSON).toBeUndefined();
    expect(env.AI_TOOL_TIMEOUT_MS).toBe(15_000);

    const key32 = Buffer.alloc(32, 7).toString('base64');
    const set = validateEnv({
      ...minimal,
      CREDENTIALS_ENCRYPTION_KEY: key32,
      AI_ALLOW_MOCK_PROVIDER: 'true',
      AI_PRICING_JSON: '[]',
      AI_TOOL_TIMEOUT_MS: '30000',
    });
    expect(set.CREDENTIALS_ENCRYPTION_KEY).toBe(key32);
    expect(set.AI_ALLOW_MOCK_PROVIDER).toBe(true);
    expect(set.AI_PRICING_JSON).toBe('[]');
    expect(set.AI_TOOL_TIMEOUT_MS).toBe(30_000);
    expect(() => validateEnv({ ...minimal, AI_TOOL_TIMEOUT_MS: '10' })).toThrow(
      /AI_TOOL_TIMEOUT_MS/,
    );
    expect(() => validateEnv({ ...minimal, CREDENTIALS_ENCRYPTION_KEY: 'c2VjcmV0' })).toThrow(
      /CREDENTIALS_ENCRYPTION_KEY must be base64 of exactly 32 bytes/,
    );
  });
});
