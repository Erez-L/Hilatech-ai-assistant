import { z } from 'zod';

/**
 * Workers environment contract. Validated once at boot (see `validateEnv`); the process refuses to start
 * with a readable list of problems instead of failing later inside a job.
 */
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()),
  );

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    REDIS_URL: z.string().url({ message: 'REDIS_URL must be a redis:// or rediss:// URL' }),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    /** Max PostgreSQL connections in this process's pool (default 10). Total = tasks x pool size. */
    DB_POOL_MAX: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(200).default(10),
    ),

    APP_URL: z.string().url().default('http://localhost:3000'),

    EMAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
    EMAIL_FROM: z.string().min(3).default('HilaTech AI Assistant <no-reply@localhost>'),
    SMTP_HOST: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    SMTP_PORT: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(65535).default(587),
    ),
    SMTP_SECURE: z.preprocess(emptyToUndefined, booleanFromEnv.default(false)),
    SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
    SMTP_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),

    WORKERS_HEALTH_PORT: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(0).max(65535).default(4100),
    ),
    WORKER_CONCURRENCY: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(100).default(5),
    ),
    /** BullMQ key prefix. Must match the producer (API). Defaults to BullMQ's own default. */
    BULLMQ_PREFIX: z.preprocess(emptyToUndefined, z.string().min(1).max(50).default('bull')),
    /** Seconds to wait for in-flight jobs on shutdown before the process exits anyway. */
    SHUTDOWN_TIMEOUT_SECONDS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(600).default(30),
    ),

    // --- AI engine (ai-tasks queue) -------------------------------------------------------------
    /**
     * Base64 32-byte key used to decrypt organization AI provider keys (shared with the API). Optional:
     * without it only providers that need no key (mock) can run; others fail with AiNotConfiguredError.
     */
    CREDENTIALS_ENCRYPTION_KEY: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .refine((v) => Buffer.from(v.trim(), 'base64').length === 32, {
          message: 'CREDENTIALS_ENCRYPTION_KEY must be base64 of exactly 32 bytes',
        })
        .optional(),
    ),
    /** Allow the deterministic in-process mock provider (refused in production by the engine). */
    AI_ALLOW_MOCK_PROVIDER: z.preprocess(emptyToUndefined, booleanFromEnv.default(false)),
    /** Optional pricing table (JSON array) for cost estimates; invalid JSON is logged and ignored. */
    AI_PRICING_JSON: z.preprocess(emptyToUndefined, z.string().optional()),
    // --- Automation (workflows, outbound webhooks) --------------------------------------------------
    /**
     * Comma-separated hostnames allowed to resolve to private addresses for admin-configured outbound
     * targets (e.g. an in-cluster n8n). Everything else must resolve to public addresses (SSRF guard).
     */
    OUTBOUND_ALLOWED_HOSTS: z.preprocess(
      (v) => (typeof v === 'string' ? v : ''),
      z.string().transform((s) =>
        s
          .split(',')
          .map((h) => h.trim().toLowerCase())
          .filter(Boolean),
      ),
    ),
    /** Register the every-minute `schedule_tick` job (disable in tests / secondary deployments). */
    AUTOMATION_SCHEDULER_ENABLED: z.preprocess(emptyToUndefined, booleanFromEnv.default(true)),
    /** Timeout of one outbound webhook delivery request. */
    WEBHOOK_DELIVERY_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1000).max(60_000).default(10_000),
    ),
    /** Per-tool-call timeout inside agent executions. */
    AI_TOOL_TIMEOUT_MS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1000).max(300_000).default(15_000),
    ),

    // --- Object storage (document-processing reads the files the API stored) ------------------------
    STORAGE_DRIVER: z.preprocess(emptyToUndefined, z.enum(['local', 's3']).default('local')),
    /** Relative paths are resolved against the monorepo root so API and workers share the directory. */
    STORAGE_LOCAL_PATH: z.preprocess(emptyToUndefined, z.string().default('./uploads')),
    S3_BUCKET: z.preprocess(emptyToUndefined, z.string().optional()),
    S3_REGION: z.preprocess(emptyToUndefined, z.string().optional()),
    S3_ENDPOINT: z.preprocess(emptyToUndefined, z.string().optional()),
    S3_ACCESS_KEY_ID: z.preprocess(emptyToUndefined, z.string().optional()),
    S3_SECRET_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when STORAGE_DRIVER=s3',
      });
    }
    if (env.EMAIL_DRIVER === 'smtp') {
      if (!env.SMTP_HOST) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_HOST'],
          message: 'SMTP_HOST is required when EMAIL_DRIVER=smtp',
        });
      }
      if ((env.SMTP_USER && !env.SMTP_PASSWORD) || (!env.SMTP_USER && env.SMTP_PASSWORD)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SMTP_USER'],
          message: 'SMTP_USER and SMTP_PASSWORD must be set together',
        });
      }
    }
  });

export type WorkersEnv = z.infer<typeof envSchema>;

/** Used by `ConfigModule.forRoot({ validate })`. Throws a readable error listing every problem. */
export function validateEnv(config: Record<string, unknown>): WorkersEnv {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new Error(`Invalid workers environment:\n${lines.join('\n')}`);
  }
  return result.data;
}
