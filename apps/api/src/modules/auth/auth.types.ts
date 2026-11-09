import { type AuthResponse } from '@hilatech/contracts';
import { z } from 'zod';

/** Service → controller hand-off: the controller sets the refresh cookie, the body goes to the client. */
export interface AuthResult {
  body: AuthResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * A login session (= refresh-token family) as listed by GET /auth/sessions.
 * TODO(contracts): move to `@hilatech/contracts` as `authSessionSchema` once the package is updated.
 */
export const authSessionSchema = z.object({
  familyId: z.string().uuid(),
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  current: z.boolean(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

export const acceptedResponseSchema = z.object({ accepted: z.literal(true), message: z.string() });
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;
