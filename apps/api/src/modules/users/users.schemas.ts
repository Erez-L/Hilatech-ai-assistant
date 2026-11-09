import { notificationPreferencesSchema } from '@hilatech/contracts';
import { z } from 'zod';

/**
 * User-profile contracts not yet present in `@hilatech/contracts`.
 * TODO(contracts): move `updateProfileSchema` and `userPreferencesSchema` into the shared package.
 */
export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
  })
  .strict();
export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;

export const userPreferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).default('system'),
    locale: z.string().trim().min(2).max(16).default('en'),
    notifications: notificationPreferencesSchema.default({}),
  })
  .strict();
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'system',
  locale: 'en',
  notifications: {},
};
