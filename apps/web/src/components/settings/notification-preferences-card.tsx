'use client';

import * as React from 'react';
import { NotificationType, type NotificationPreferences } from '@hilatech/contracts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Switch,
  toast,
} from '@hilatech/ui';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/hooks/queries';
import { QueryState } from '@/components/common/query-state';
import { useT } from '@/i18n/provider';
import { msg, type Msg } from '@/i18n/msg';

type Channel = 'inApp' | 'email';

export const NOTIFICATION_TYPE_LABELS: Record<
  NotificationType,
  { label: Msg; description: Msg; group: Msg }
> = {
  lead_assigned: {
    label: msg('settings.notifications.lead_assigned'),
    description: msg('settings.notifications.lead_assigned.description'),
    group: msg('settings.notificationGroup.customers'),
  },
  conversation_assigned: {
    label: msg('settings.notifications.conversation_assigned'),
    description: msg('settings.notifications.conversation_assigned.description'),
    group: msg('settings.notificationGroup.customers'),
  },
  member_joined: {
    label: msg('settings.notifications.member_joined'),
    description: msg('settings.notifications.member_joined.description'),
    group: msg('settings.notificationGroup.team'),
  },
  invitation_received: {
    label: msg('settings.notifications.invitation_received'),
    description: msg('settings.notifications.invitation_received.description'),
    group: msg('settings.notificationGroup.team'),
  },
  agent_execution_completed: {
    label: msg('settings.notifications.agent_execution_completed'),
    description: msg('settings.notifications.agent_execution_completed.description'),
    group: msg('settings.notificationGroup.aiAndAutomation'),
  },
  agent_execution_failed: {
    label: msg('settings.notifications.agent_execution_failed'),
    description: msg('settings.notifications.agent_execution_failed.description'),
    group: msg('settings.notificationGroup.aiAndAutomation'),
  },
  document_processed: {
    label: msg('settings.notifications.document_processed'),
    description: msg('settings.notifications.document_processed.description'),
    group: msg('settings.notificationGroup.aiAndAutomation'),
  },
  document_failed: {
    label: msg('settings.notifications.document_failed'),
    description: msg('settings.notifications.document_failed.description'),
    group: msg('settings.notificationGroup.aiAndAutomation'),
  },
  automation_failed: {
    label: msg('settings.notifications.automation_failed'),
    description: msg('settings.notifications.automation_failed.description'),
    group: msg('settings.notificationGroup.aiAndAutomation'),
  },
  task_assigned: {
    label: msg('settings.notifications.task_assigned'),
    description: msg('settings.notifications.task_assigned.description'),
    group: msg('settings.notificationGroup.customers'),
  },
  task_reminder: {
    label: msg('settings.notifications.task_reminder'),
    description: msg('settings.notifications.task_reminder.description'),
    group: msg('settings.notificationGroup.customers'),
  },
  system: {
    label: msg('settings.notifications.system'),
    description: msg('settings.notifications.system.description'),
    group: msg('settings.notificationGroup.platform'),
  },
};

/** Preferences default to "on": a type missing from the server response is treated as enabled. */
export function isEnabled(
  prefs: NotificationPreferences,
  channel: Channel,
  type: NotificationType,
) {
  return prefs[channel]?.[type] ?? true;
}

export function NotificationPreferencesCard() {
  const t = useT();
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  const groups = React.useMemo(() => {
    const map = new Map<string, NotificationType[]>();
    for (const type of NotificationType.options) {
      const group = t(NOTIFICATION_TYPE_LABELS[type].group);
      map.set(group, [...(map.get(group) ?? []), type]);
    }
    return Array.from(map.entries());
  }, [t]);

  const toggle = (
    current: NotificationPreferences,
    channel: Channel,
    type: NotificationType,
    on: boolean,
  ) => {
    const next: NotificationPreferences = {
      inApp: { ...(current.inApp ?? {}) },
      email: { ...(current.email ?? {}) },
      [channel]: { ...(current[channel] ?? {}), [type]: on },
    };
    update.mutate(next, {
      onSuccess: () => toast.success(t('settings.notificationPreferencesSaved')),
    });
  };

  return (
    <Card id="notifications">
      <CardHeader>
        <CardTitle>{t('settings.notificationPreferences')}</CardTitle>
        <CardDescription>{t('settings.chooseWhichEventsReachYou')}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <QueryState
          query={prefs}
          compact
          loading={
            <ul className="divide-y divide-border" aria-busy>
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                  <div className="flex gap-6">
                    <Skeleton className="h-5 w-9 rounded-full" />
                    <Skeleton className="h-5 w-9 rounded-full" />
                  </div>
                </li>
              ))}
            </ul>
          }
        >
          {(data) => (
            <div className="flex flex-col">
              <div className="grid grid-cols-[1fr_4rem_4rem] items-center gap-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium text-fg-muted">
                <span>{t('common.event')}</span>
                <span className="text-center">{t('settings.inApp')}</span>
                <span className="text-center">{t('common.email')}</span>
              </div>
              {groups.map(([group, types]) => (
                <section key={group} aria-labelledby={`notif-group-${group}`}>
                  <h4
                    id={`notif-group-${group}`}
                    className="px-5 pt-4 pb-1 text-xs font-semibold tracking-wide rtl:tracking-normal text-fg-subtle uppercase"
                  >
                    {group}
                  </h4>
                  <ul className="divide-y divide-border">
                    {types.map((type) => {
                      const meta = NOTIFICATION_TYPE_LABELS[type];
                      return (
                        <li
                          key={type}
                          className="grid grid-cols-[1fr_4rem_4rem] items-center gap-4 px-5 py-3"
                        >
                          <div className="flex min-w-0 flex-col">
                            <span id={`notif-${type}`} className="text-sm font-medium">
                              {t(meta.label)}
                            </span>
                            <span className="text-xs text-fg-muted">{t(meta.description)}</span>
                          </div>
                          {(['inApp', 'email'] as const).map((channel) => (
                            <div key={channel} className="flex justify-center">
                              <Switch
                                aria-label={t('settings.notificationChannelAria', {
                                  label: t(meta.label),
                                  channel: t(
                                    channel === 'inApp'
                                      ? 'settings.channelInApp'
                                      : 'settings.channelEmail',
                                  ),
                                })}
                                checked={isEnabled(data, channel, type)}
                                disabled={update.isPending}
                                onCheckedChange={(on) => toggle(data, channel, type, on)}
                              />
                            </div>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
