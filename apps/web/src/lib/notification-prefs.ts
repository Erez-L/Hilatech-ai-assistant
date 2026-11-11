import { NotificationType, type NotificationPreferences } from '@hilatech/contracts';

export type NotificationChannel = 'inApp' | 'email';

/** A type missing from the stored map counts as enabled (the server default). */
export function isNotificationEnabled(
  prefs: NotificationPreferences | undefined,
  channel: NotificationChannel,
  type: NotificationType,
): boolean {
  return prefs?.[channel]?.[type] ?? true;
}

/** True only when every notification type is enabled on the channel. */
export function isChannelFullyEnabled(
  prefs: NotificationPreferences | undefined,
  channel: NotificationChannel,
): boolean {
  return NotificationType.options.every((type) => isNotificationEnabled(prefs, channel, type));
}

/**
 * Sets every notification type of one channel and keeps the other channel untouched. The result is
 * the exact `{ inApp?: Record<type, boolean>, email?: Record<type, boolean> }` shape the API accepts
 * (never `{ inApp: boolean, email: boolean }`).
 */
export function setChannelForAll(
  prefs: NotificationPreferences | undefined,
  channel: NotificationChannel,
  enabled: boolean,
): NotificationPreferences {
  const all = Object.fromEntries(NotificationType.options.map((type) => [type, enabled])) as Record<
    NotificationType,
    boolean
  >;
  return {
    inApp: { ...(prefs?.inApp ?? {}) },
    email: { ...(prefs?.email ?? {}) },
    [channel]: all,
  };
}
