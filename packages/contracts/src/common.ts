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
  ORGANIZATION_REQUIRED: 'ORGANIZATION_REQUIRED',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  ENTITLEMENT_EXCEEDED: 'ENTITLEMENT_EXCEEDED',
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
