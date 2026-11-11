import { parseDuration } from '@hilatech/shared';
import { z } from 'zod';

/**
 * Environment validation for the API. Every variable from `.env.example` that the API consumes is
 * declared here with development defaults. In production the schema refuses placeholder / weak secrets.
 */

const PLACEHOLDER_SECRET = /^(change-me|changeme|replace-me|todo|secret|dev-only|example)/i;

/** dotenv keeps inline comments when values are unquoted in some edge cases; strip them defensively. */
const stripInlineComment = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+#.*$/, '').trim() : value;

const stringVar = () => z.preprocess(stripInlineComment, z.string());
const optionalString = () =>
  z.preprocess((v) => {
    const s = stripInlineComment(v);
    return s === '' ? undefined : s;
  }, z.string().optional());
const boolVar = (defaultValue: boolean) =>
  z.preprocess((v) => {
    const s = stripInlineComment(v);
    if (s === undefined || s === '') return defaultValue;
    if (typeof s === 'boolean') return s;
    return ['1', 'true', 'yes', 'on'].includes(String(s).toLowerCase());
  }, z.boolean());
const intVar = (defaultValue: number, min = 0) =>
  z.preprocess((v) => {
    const s = stripInlineComment(v);
    if (s === undefined || s === '') return defaultValue;
    return Number(s);
  }, z.number().int().min(min));
const durationVar = (defaultValue: string) =>
  z.preprocess(
    (v) => {
      const s = stripInlineComment(v);
      return s === undefined || s === '' ? defaultValue : s;
    },
    z.string().refine(
      (v) => {
        try {
          parseDuration(v);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Expected a duration like "15m", "7d" or "900s"' },
    ),
  );

export const DEV_JWT_ACCESS_SECRET = 'dev-only-access-secret-do-not-use-in-production-0001';
export const DEV_JWT_REFRESH_SECRET = 'dev-only-refresh-secret-do-not-use-in-production-0001';

export const envSchema = z
  .object({
    NODE_ENV: z.preprocess(
      (v) => stripInlineComment(v) || 'development',
      z.enum(['development', 'test', 'production']),
    ),
    LOG_LEVEL: z.preprocess(
      (v) => stripInlineComment(v) || 'info',
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    ),

    // URLs
    API_PORT: intVar(4000, 1),
    API_URL: z.preprocess(
      (v) => stripInlineComment(v) || 'http://localhost:4000',
      z.string().url(),
    ),
    APP_URL: z.preprocess(
      (v) => stripInlineComment(v) || 'http://localhost:3000',
      z.string().url(),
    ),
    CORS_ORIGINS: z.preprocess(
      (v) => stripInlineComment(v) || 'http://localhost:3000',
      z.string().transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),
    ),
    TRUST_PROXY: boolVar(false),
    REQUEST_TIMEOUT_MS: intVar(30_000, 1_000),
    BODY_LIMIT: z.preprocess((v) => stripInlineComment(v) || '1mb', z.string()),
    SWAGGER_ENABLED: boolVar(false),

    // Database & cache
    DATABASE_URL: stringVar().pipe(z.string().min(1, 'DATABASE_URL is required')),
    REDIS_URL: z.preprocess(
      (v) => stripInlineComment(v) || 'redis://localhost:6379',
      z.string().regex(/^rediss?:\/\//, 'REDIS_URL must start with redis:// or rediss://'),
    ),
    /** BullMQ key prefix — must match the workers app (their default is BullMQ's own default, "bull"). */
    BULLMQ_PREFIX: z.preprocess(
      (v) => stripInlineComment(v) || 'bull',
      z.string().regex(/^[A-Za-z0-9_-]+$/),
    ),
    /**
     * Max PostgreSQL connections in THIS process's pool (default 10). Total connections = tasks x pool size, so size it
     * against the database's `max_connections` (or RDS Proxy) - see docs/operations/load-test-results.md.
     */
    DB_POOL_MAX: intVar(10, 1),

    // Auth
    JWT_ACCESS_SECRET: z.preprocess(
      (v) => stripInlineComment(v) || DEV_JWT_ACCESS_SECRET,
      z.string(),
    ),
    JWT_REFRESH_SECRET: z.preprocess(
      (v) => stripInlineComment(v) || DEV_JWT_REFRESH_SECRET,
      z.string(),
    ),
    JWT_ACCESS_TTL: durationVar('15m'),
    JWT_REFRESH_TTL: durationVar('30d'),
    PASSWORD_RESET_TTL: durationVar('1h'),
    EMAIL_VERIFICATION_TTL: durationVar('24h'),
    INVITATION_TTL: durationVar('7d'),
    COOKIE_SECURE: boolVar(false),
    /** Block everything except the session/profile/verification routes until the email address is verified. */
    REQUIRE_EMAIL_VERIFICATION: boolVar(false),
    /** Minimum time between two verification emails for the same account. */
    EMAIL_VERIFICATION_RESEND_COOLDOWN: durationVar('60s'),
    COOKIE_DOMAIN: optionalString(),

    // Rate limiting
    RATE_LIMIT_TTL_SECONDS: intVar(60, 1),
    RATE_LIMIT_MAX: intVar(120, 1),
    AUTH_RATE_LIMIT_MAX: intVar(10, 1),
    /** Per-IP limit (per RATE_LIMIT_TTL_SECONDS window) for the public inbound webhook route `POST /hooks/...`. */
    WEBHOOK_RATE_LIMIT_MAX: intVar(120, 1),

    // Automation / outbound HTTP
    /**
     * Comma-separated hostnames that may resolve to private addresses for admin-configured outbound targets
     * (e.g. an in-cluster n8n). Everything else is subject to the SSRF guard (public addresses only).
     */
    OUTBOUND_ALLOWED_HOSTS: z.preprocess(
      (v) => stripInlineComment(v) || '',
      z.string().transform((s) =>
        s
          .split(',')
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean),
      ),
    ),

    // Email
    EMAIL_DRIVER: z.preprocess((v) => stripInlineComment(v) || 'log', z.enum(['log', 'smtp'])),
    EMAIL_FROM: z.preprocess(
      (v) => stripInlineComment(v) || 'HilaTech AI Assistant <no-reply@localhost>',
      z.string(),
    ),
    SMTP_HOST: optionalString(),
    SMTP_PORT: intVar(587, 1),
    SMTP_SECURE: boolVar(false),
    SMTP_USER: optionalString(),
    SMTP_PASSWORD: optionalString(),

    // Object storage (documents)
    STORAGE_DRIVER: z.preprocess((v) => stripInlineComment(v) || 'local', z.enum(['local', 's3'])),
    STORAGE_LOCAL_PATH: z.preprocess((v) => stripInlineComment(v) || './uploads', z.string()),
    MAX_UPLOAD_MB: intVar(25, 1),
    S3_BUCKET: optionalString(),
    S3_REGION: optionalString(),
    S3_ENDPOINT: optionalString(),
    S3_ACCESS_KEY_ID: optionalString(),
    S3_SECRET_ACCESS_KEY: optionalString(),

    // Secrets for later milestones (optional, validated for shape when present)
    CREDENTIALS_ENCRYPTION_KEY: optionalString(),

    // AI platform (Priority 3)
    /** Allow the deterministic in-process `mock` provider (never honoured in production). */
    AI_ALLOW_MOCK_PROVIDER: boolVar(false),
    /**
     * Allow organizations to add the `bedrock` provider. Bedrock calls are authenticated with the SERVER's AWS
     * identity (IAM task role / SSO profile) and billed to the platform's AWS account, so this is off by default.
     */
    AI_BEDROCK_ENABLED: boolVar(false),
    /** Informational: the AWS SDK itself reads AWS_REGION / AWS_PROFILE; this schema only validates the shape. */
    AWS_REGION: z.preprocess(
      (v) => {
        const s = stripInlineComment(v);
        return s === '' ? undefined : s;
      },
      z
        .string()
        .regex(/^[a-z]{2}(-[a-z]+)+-\d$/, 'AWS_REGION must look like us-east-1')
        .optional(),
    ),
    /** Optional JSON pricing table (USD per 1M tokens); invalid content is logged and ignored. */
    AI_PRICING_JSON: optionalString(),
    /** Per-tool-call timeout inside assistant/agent runs. */
    AI_TOOL_TIMEOUT_MS: intVar(15_000, 1_000),
    /** Per-call timeout for upstream provider requests. */
    AI_PROVIDER_TIMEOUT_MS: intVar(60_000, 1_000),
  })
  .superRefine((env, ctx) => {
    const isProd = env.NODE_ENV === 'production';
    const checkSecret = (key: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET') => {
      const value = env[key];
      const weak =
        value.length < 32 || PLACEHOLDER_SECRET.test(value) || value.startsWith('dev-only');
      if (isProd && weak) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must be a non-placeholder secret of at least 32 characters in production`,
        });
      }
    };
    checkSecret('JWT_ACCESS_SECRET');
    checkSecret('JWT_REFRESH_SECRET');
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET && isProd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      });
    }
    if (isProd && !env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production',
      });
    }
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when STORAGE_DRIVER=s3',
      });
    }
    if (env.EMAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when EMAIL_DRIVER=smtp',
      });
    }
    if (env.CREDENTIALS_ENCRYPTION_KEY) {
      const bytes = Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, 'base64').length;
      if (bytes !== 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CREDENTIALS_ENCRYPTION_KEY'],
          message: 'CREDENTIALS_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
        });
      }
    }
  })
  .transform((env) => ({
    ...env,
    // The mock provider is a development/test convenience; production never gets it, whatever the flag says.
    AI_ALLOW_MOCK_PROVIDER: env.AI_ALLOW_MOCK_PROVIDER && env.NODE_ENV !== 'production',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    swaggerEnabled: env.NODE_ENV !== 'production' || env.SWAGGER_ENABLED,
    accessTtlMs: parseDuration(env.JWT_ACCESS_TTL),
    refreshTtlMs: parseDuration(env.JWT_REFRESH_TTL),
    passwordResetTtlMs: parseDuration(env.PASSWORD_RESET_TTL),
    emailVerificationTtlMs: parseDuration(env.EMAIL_VERIFICATION_TTL),
    emailVerificationResendCooldownMs: parseDuration(env.EMAIL_VERIFICATION_RESEND_COOLDOWN),
    invitationTtlMs: parseDuration(env.INVITATION_TTL),
  }));

export type Env = z.infer<typeof envSchema>;

/** Used by Nest's ConfigModule (`validate`). Throws a readable error listing every invalid variable. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
