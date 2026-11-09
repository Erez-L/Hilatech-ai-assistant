'use client';

import * as React from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck } from 'lucide-react';
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  cn,
} from '@hilatech/ui';
import { isApiError } from '@/lib/api';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/hooks/queries';

export function NotificationsMenu() {
  const query = useNotifications(true);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unavailable = query.isError && isApiError(query.error) && query.error.isNotFound;
  const items = query.data?.data ?? [];
  const count = items.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
          className="relative"
        >
          <Bell aria-hidden />
          {count > 0 ? (
            <span
              className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] leading-4 font-semibold text-accent-fg"
              aria-hidden
            >
              {count > 9 ? '9+' : count}
            </span>
          ) : null}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">Notifications</h2>
          {count > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<CheckCheck aria-hidden />}
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto scrollbar-thin">
          {query.isPending ? (
            <div className="flex flex-col gap-3 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : unavailable ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">
              Notifications arrive in an upcoming milestone.
            </p>
          ) : query.isError ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <p className="text-sm text-fg-muted">Notifications could not be loaded.</p>
              <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </div>
          ) : count === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const body = (
                  <>
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-fg">{n.title}</span>
                      <span className="shrink-0 text-xs text-fg-subtle">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </span>
                    </span>
                    {n.body ? (
                      <span className="line-clamp-2 text-xs text-fg-muted">{n.body}</span>
                    ) : null}
                  </>
                );
                const className = cn(
                  'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-surface-muted',
                  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        className={className}
                        onClick={() => markRead.mutate(n.id)}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className={className}
                        onClick={() => markRead.mutate(n.id)}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
