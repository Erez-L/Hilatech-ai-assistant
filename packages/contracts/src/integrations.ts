import { z } from 'zod';
import { idSchema, timestampsSchema } from './common';

// ---------------------------------------------------------------------------
// Integrations — connections to external systems. Non-secret settings live in `config`; credentials are
// write-only and stored encrypted. Nothing is assumed configured without credentials.
// ---------------------------------------------------------------------------

export const IntegrationKind = z.enum(['email', 'whatsapp', 'crm', 'rest', 'n8n']);
export type IntegrationKind = z.infer<typeof IntegrationKind>;

export const IntegrationStatus = z.enum(['unconfigured', 'connected', 'error']);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

/** Per-kind non-secret configuration. */
export const integrationConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('email'),
    provider: z.enum(['smtp']),
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535).default(587),
    secure: z.boolean().default(false),
    fromAddress: z.string().trim().email(),
    fromName: z.string().trim().max(120).optional(),
  }),
  z.object({
    kind: z.literal('whatsapp'),
    /** Only approved providers; the platform never scrapes or automates the consumer app. */
    provider: z.enum(['meta_cloud_api', 'twilio']),
    phoneNumberId: z.string().trim().min(1).max(64).optional(),
    businessAccountId: z.string().trim().min(1).max(64).optional(),
    fromNumber: z.string().trim().min(3).max(32).optional(),
  }),
  z.object({
    kind: z.literal('crm'),
    provider: z.enum(['hubspot', 'pipedrive', 'salesforce', 'generic']),
    baseUrl: z.string().trim().url().optional(),
    /** Field mapping from HilaTech lead fields to the external CRM. */
    fieldMapping: z.record(z.string(), z.string()).default({}),
  }),
  z.object({
    kind: z.literal('rest'),
    baseUrl: z.string().trim().url(),
    /** Static headers sent with every request (no secrets here — use `secrets.headers`). */
    headers: z.record(z.string(), z.string()).default({}),
    authType: z.enum(['none', 'bearer', 'basic', 'header']).default('none'),
    authHeaderName: z.string().trim().max(80).optional(),
  }),
  z.object({
    kind: z.literal('n8n'),
    baseUrl: z.string().trim().url(),
    /** Default webhook path prefix, e.g. `/webhook`. */
    webhookPathPrefix: z.string().trim().max(200).default('/webhook'),
  }),
]);
export type IntegrationConfig = z.infer<typeof integrationConfigSchema>;

/** Write-only secrets per kind. */
export const integrationSecretsSchema = z
  .object({
    username: z.string().max(255).optional(),
    password: z.string().max(1024).optional(),
    apiKey: z.string().max(2048).optional(),
    accessToken: z.string().max(4096).optional(),
    headers: z.record(z.string(), z.string().max(2048)).optional(),
  })
  .strict();
export type IntegrationSecrets = z.infer<typeof integrationSecretsSchema>;

export const integrationSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    kind: IntegrationKind,
    name: z.string(),
    config: z.record(z.string(), z.unknown()),
    hasSecrets: z.boolean(),
    /** Names of the secret fields that are set (never the values). */
    secretKeys: z.array(z.string()),
    isEnabled: z.boolean(),
    status: IntegrationStatus,
    lastCheckedAt: z.string().datetime().nullable(),
    lastError: z.string().nullable(),
  })
  .merge(timestampsSchema);
export type Integration = z.infer<typeof integrationSchema>;

export const createIntegrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  config: integrationConfigSchema,
  secrets: integrationSecretsSchema.optional(),
  isEnabled: z.boolean().default(true),
});
export type CreateIntegrationRequest = z.infer<typeof createIntegrationSchema>;

export const updateIntegrationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  config: integrationConfigSchema.optional(),
  /** Merged into the stored secrets; pass an empty string to delete a key. */
  secrets: integrationSecretsSchema.optional(),
  isEnabled: z.boolean().optional(),
});
export type UpdateIntegrationRequest = z.infer<typeof updateIntegrationSchema>;

export const integrationTestResultSchema = z.object({
  ok: z.boolean(),
  status: IntegrationStatus,
  checkedAt: z.string().datetime(),
  latencyMs: z.number().int().nonnegative().nullable(),
  message: z.string(),
});
export type IntegrationTestResult = z.infer<typeof integrationTestResultSchema>;

/** Catalogue entry describing what each integration kind needs (drives the setup UI). */
export const integrationCatalogueEntrySchema = z.object({
  kind: IntegrationKind,
  name: z.string(),
  description: z.string(),
  providers: z.array(z.string()),
  requiredSecrets: z.array(z.string()),
  /** Whether live delivery through this kind is implemented in this release. */
  liveSupport: z.enum(['full', 'partial', 'planned']),
});
export type IntegrationCatalogueEntry = z.infer<typeof integrationCatalogueEntrySchema>;
