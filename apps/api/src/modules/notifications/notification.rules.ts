import {
  type NotificationPreferences,
  type NotificationType,
  notificationPreferencesSchema,
} from '@hilatech/contracts';

/**
 * Pure preference logic for notifications.
 *
 * - In-app notifications are ON unless the user explicitly disabled the type.
 * - Email notifications are OFF unless the user explicitly enabled the type.
 */
export const NotificationRules = {
  /** Reads the `notifications` key of `User.preferences` leniently (unknown/invalid → no preferences). */
  preferencesFrom(userPreferences: unknown): NotificationPreferences {
    const notifications =
      userPreferences && typeof userPreferences === 'object' && !Array.isArray(userPreferences)
        ? (userPreferences as Record<string, unknown>).notifications
        : undefined;
    const parsed = notificationPreferencesSchema.safeParse(notifications ?? {});
    return parsed.success ? parsed.data : {};
  },

  inAppEnabled(prefs: NotificationPreferences, type: NotificationType): boolean {
    return prefs.inApp?.[type] !== false;
  },

  emailEnabled(prefs: NotificationPreferences, type: NotificationType): boolean {
    return prefs.email?.[type] === true;
  },
};
