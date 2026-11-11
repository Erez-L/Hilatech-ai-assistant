import { z } from 'zod';
import { notificationPreferencesSchema } from '@hilatech/contracts';

/**
 * Shapes used by the web app that are NOT yet in @hilatech/contracts.
 * They mirror the endpoint map in docs/api/api-overview.md and should be moved into the
 * contracts package once the backend confirms them (see apps/web/README.md → Contract gaps).
 */

/** GET /permissions */
export interface PermissionDefinition {
  key: string;
  group: string;
  description: string | null;
}

/** GET /auth/sessions (normalised; the API returns `lastActiveAt`, older drafts said `lastUsedAt`). */
export interface AuthSessionInfo {
  familyId: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string | null;
  current: boolean;
}

/** PUT /users/me/preferences */
export const userPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  locale: z.string().trim().min(2).max(16),
  /** Per-type maps per channel, exactly as the API stores them (missing type = enabled). */
  notifications: notificationPreferencesSchema,
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  locale: 'en',
  notifications: {},
};

/** PATCH /users/me */
export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(80),
  lastName: z.string().trim().min(1, 'Enter your last name').max(80),
  avatarUrl: z.union([z.string().url('Enter a valid URL'), z.literal('')]).optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;
