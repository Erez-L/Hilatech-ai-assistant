import { z } from 'zod';
import { idSchema } from './common';

/**
 * Auth contracts.
 *
 * Token model:
 *  - Access token: short-lived JWT returned in the JSON body. The web client keeps it in memory only.
 *  - Refresh token: opaque, long-lived, delivered as an httpOnly, Secure, SameSite=Lax cookie
 *    scoped to the auth path. Rotated on every use; reuse of a rotated token revokes the whole family.
 */

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
    message: 'Password must include upper and lower case letters and a number',
  });

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  /** Optional invitation token: when present, the user joins that organization instead of creating one. */
  invitationToken: z.string().min(16).max(256).optional(),
});
export type RegisterRequest = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(16).max(256) });
export type VerifyEmailRequest = z.infer<typeof verifyEmailSchema>;

export const authUserSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  avatarUrl: z.string().url().nullable(),
  emailVerifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const organizationSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().url().nullable(),
  /** Role of the current user in this organization */
  roleKey: z.string(),
  roleName: z.string(),
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds until access token expiry */
  expiresIn: z.number().int().positive(),
  tokenType: z.literal('Bearer'),
  user: authUserSchema,
  organizations: z.array(organizationSummarySchema),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Returned by GET /auth/me — includes the resolved permissions for the active organization (if any). */
export const sessionSchema = z.object({
  user: authUserSchema,
  organizations: z.array(organizationSummarySchema),
  activeOrganization: organizationSummarySchema.nullable(),
  permissions: z.array(z.string()),
});
export type Session = z.infer<typeof sessionSchema>;

/** Claims inside the access JWT. `org` is optional: tokens are user-scoped; organization context
 *  is selected per request via the organization header and validated against membership. */
export const accessTokenClaimsSchema = z.object({
  sub: idSchema,
  email: z.string().email(),
  sid: z.string(), // session id (refresh-token family id)
  iat: z.number(),
  exp: z.number(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

export const REFRESH_COOKIE_NAME = 'hta_refresh' as const;
