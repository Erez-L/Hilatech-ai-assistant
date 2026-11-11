import { z } from 'zod';

/**
 * API versioning and conventions shared by all clients.
 */
export const API_PREFIX = '/api/v1' as const;

/** Header the client uses to SELECT an organization. The server NEVER trusts it blindly:
 *  it validates that the authenticated user is an active member of that organization. */
export const ORGANIZATION_HEADER = 'x-organization-id' as const;
export const REQUEST_ID_HEADER = 'x-request-id' as const;

// ---------------------------------------------------------------------------
// Standard response envelope
// ---------------------------------------------------------------------------

/**
 * `schema.partial()` for PATCH bodies derived from a create schema. zod 4 applies `.default()` /
 * `.prefault()` even when the key is optional, so a plain `.partial()` would silently write the
 * create-time defaults (status, tags, isEnabled, ...) on every update. This strips them first:
 * an omitted key stays `undefined`.
 */
export function partialUpdate<T extends z.ZodObject>(schema: T): ReturnType<T['partial']> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    let inner = field;
    while (inner instanceof z.ZodDefault || inner instanceof z.ZodPrefault) {
      inner = inner.unwrap() as z.ZodType;
    }
    shape[key] = inner.optional();
  }
  return z.object(shape) as unknown as ReturnType<T['partial']>;
}

export const paginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export interface ApiSuccess<T> {
  data: T;
  meta?: PaginationMeta | Record<string, unknown>;
}

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_REUSED: 'TOKEN_REUSED',
  FORBIDDEN: 'FORBIDDEN',
  /** 403 — `REQUIRE_EMAIL_VERIFICATION` is on and the account's email address is not verified yet. */
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  ORGANIZATION_REQUIRED: 'ORGANIZATION_REQUIRED',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  ENTITLEMENT_EXCEEDED: 'ENTITLEMENT_EXCEEDED',
  /** 402 — the organization's configured monthly AI budget (hard stop) is used up; AI requests are refused before any provider call. */
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  /** 501 — no payment provider is configured; checkout/plan changes through the API are unavailable. */
  PAYMENT_NOT_CONFIGURED: 'PAYMENT_NOT_CONFIGURED',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  /** 409 — the organization has no usable AI provider configuration (or the selected one is disabled / has no key). */
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  /** 502 — the upstream AI provider failed; `details.code` carries the normalised engine code (auth, rate_limited, …). */
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  /** 422 — an assistant/agent run hit a configured or hard limit (steps, tokens, duration, delegations). */
  AI_LIMIT_EXCEEDED: 'AI_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const sortOrderSchema = z.enum(['asc', 'desc']);
export type SortOrder = z.infer<typeof sortOrderSchema>;

export const idSchema = z.string().uuid();

export const timestampsSchema = z.object({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** Minimal user shape embedded in other resources (assignee, owner, author). Never includes credentials. */
export const userSummarySchema = z.object({
  id: idSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;
