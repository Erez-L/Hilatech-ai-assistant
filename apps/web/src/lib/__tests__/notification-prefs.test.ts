import { describe, expect, it } from 'vitest';
import { NotificationType, notificationPreferencesSchema } from '@hilatech/contracts';
import { DEFAULT_PREFERENCES, userPreferencesSchema } from '@/lib/api/types';
import {
  isChannelFullyEnabled,
  isNotificationEnabled,
  setChannelForAll,
} from '@/lib/notification-prefs';

describe('notification preferences', () => {
  it('never produces the old { email, inApp } boolean shape (the API rejects it with 400)', () => {
    const next = setChannelForAll({}, 'email', false);
    expect(typeof next.email).toBe('object');
    expect(notificationPreferencesSchema.strict().safeParse(next).success).toBe(true);
    expect(notificationPreferencesSchema.safeParse({ email: true, inApp: true }).success).toBe(
      false,
    );
  });

  it('switches every type of one channel and leaves the other channel alone', () => {
    const start = { inApp: { lead_assigned: false }, email: { task_reminder: false } };
    const off = setChannelForAll(start, 'inApp', false);
    expect(Object.keys(off.inApp ?? {}).sort()).toEqual([...NotificationType.options].sort());
    expect(Object.values(off.inApp ?? {}).every((v) => v === false)).toBe(true);
    expect(off.email).toEqual({ task_reminder: false });
    expect(isChannelFullyEnabled(off, 'inApp')).toBe(false);
    const on = setChannelForAll(off, 'inApp', true);
    expect(isChannelFullyEnabled(on, 'inApp')).toBe(true);
  });

  it('treats missing types as enabled', () => {
    expect(isNotificationEnabled(undefined, 'email', 'task_assigned')).toBe(true);
    expect(
      isNotificationEnabled({ email: { task_assigned: false } }, 'email', 'task_assigned'),
    ).toBe(false);
    expect(isChannelFullyEnabled({ email: { task_assigned: false } }, 'email')).toBe(false);
    expect(isChannelFullyEnabled({}, 'inApp')).toBe(true);
  });

  it('the web preferences mirror matches the API contract', () => {
    expect(userPreferencesSchema.safeParse(DEFAULT_PREFERENCES).success).toBe(true);
    expect(
      userPreferencesSchema.safeParse({
        theme: 'dark',
        locale: 'he',
        notifications: { email: { lead_assigned: false } },
      }).success,
    ).toBe(true);
    expect(
      userPreferencesSchema.safeParse({
        theme: 'dark',
        locale: 'he',
        notifications: { email: true, inApp: true },
      }).success,
    ).toBe(false);
  });
});
