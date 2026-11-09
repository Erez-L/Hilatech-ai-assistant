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

type Channel = 'inApp' | 'email';

export const NOTIFICATION_TYPE_LABELS: Record<
  NotificationType,
  { label: string; description: string; group: string }
> = {
  lead_assigned: {
    label: 'Lead assigned to me',
    description: 'When a teammate hands you a lead.',
    group: 'Customers',
  },
  conversation_assigned: {
    label: 'Conversation assigned to me',
    description: 'When a thread lands in your queue.',
    group: 'Customers',
  },
  member_joined: {
    label: 'Teammate joined',
    description: 'When an invitation is accepted.',
    group: 'Team',
  },
  invitation_received: {
    label: 'Invitation received',
    description: 'When you are invited to another organization.',
    group: 'Team',
  },
  agent_execution_completed: {
    label: 'Agent run completed',
    description: 'When an agent you started finishes.',
    group: 'AI and automation',
  },
  agent_execution_failed: {
    label: 'Agent run failed',
    description: 'When an agent run stops with an error.',
    group: 'AI and automation',
  },
  document_processed: {
    label: 'Document processed',
    description: 'When an uploaded document is ready for the assistant.',
    group: 'AI and automation',
  },
  document_failed: {
    label: 'Document failed',
    description: 'When a document could not be processed.',
    group: 'AI and automation',
  },
  automation_failed: {
    label: 'Automation failed',
    description: 'When an automation run stops with an error.',
    group: 'AI and automation',
  },
  system: {
    label: 'System announcements',
    description: 'Maintenance windows and important platform notices.',
    group: 'Platform',
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
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  const groups = React.useMemo(() => {
    const map = new Map<string, NotificationType[]>();
    for (const type of NotificationType.options) {
      const group = NOTIFICATION_TYPE_LABELS[type].group;
      map.set(group, [...(map.get(group) ?? []), type]);
    }
    return Array.from(map.entries());
  }, []);

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
    update.mutate(next, { onSuccess: () => toast.success('Notification preferences saved') });
  };

  return (
    <Card id="notifications">
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <CardDescription>
          Choose which events reach you in the app and by email. Everything is on until you turn it
          off.
        </CardDescription>
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
                <span>Event</span>
                <span className="text-center">In-app</span>
                <span className="text-center">Email</span>
              </div>
              {groups.map(([group, types]) => (
                <section key={group} aria-labelledby={`notif-group-${group}`}>
                  <h4
                    id={`notif-group-${group}`}
                    className="px-5 pt-4 pb-1 text-xs font-semibold tracking-wide text-fg-subtle uppercase"
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
                              {meta.label}
                            </span>
                            <span className="text-xs text-fg-muted">{meta.description}</span>
                          </div>
                          {(['inApp', 'email'] as const).map((channel) => (
                            <div key={channel} className="flex justify-center">
                              <Switch
                                aria-label={`${meta.label} — ${channel === 'inApp' ? 'in-app' : 'email'}`}
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
