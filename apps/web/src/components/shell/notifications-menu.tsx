'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck, Settings2, TriangleAlert, Wallet } from 'lucide-react';
import { Permission, type Notification } from '@hilatech/contracts';
import {
  Badge,
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  cn,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { budgetAlertInfo } from '@/lib/billing';
import { isSafeAppPath } from '@/lib/navigation';

const PAGE_SIZE = 20;

/** Only same-origin paths are followed from notification links. */
function safeLink(link: string | null): string | null {
  if (!link) return null;
  return isSafeAppPath(link) ? link : null;
}

export function NotificationsMenu() {
  const canRead = useCan(Permission.NOTIFICATIONS_READ);
  if (!canRead) return null;
  return <NotificationsMenuInner />;
}

function NotificationsMenuInner() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const count = useUnreadNotificationCount();
  const list = useNotifications({ unread: true, page: 1, pageSize: PAGE_SIZE });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unread = count.data ?? list.data?.meta.total ?? 0;
  const items = list.data?.data ?? [];

  const openItem = (n: Notification) => {
    markRead.mutate(n.id);
    const href = safeLink(n.link);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative"
        >
          <Bell aria-hidden />
          {unread > 0 ? (
            <span
              className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] leading-4 font-semibold text-accent-fg"
              aria-hidden
              data-testid="notifications-badge"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">
            Notifications
            {unread > 0 ? (
              <span className="ml-1.5 text-xs font-normal text-fg-muted tabular">
                {unread} unread
              </span>
            ) : null}
          </h2>
          {unread > 0 ? (
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
        <div className="max-h-96 overflow-y-auto scrollbar-thin">
          {list.isPending ? (
            <div className="flex flex-col gap-3 p-4" aria-busy>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : list.isError ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <p className="text-sm text-fg-muted">
                {getErrorMessage(list.error, 'Notifications could not be loaded.')}
              </p>
              <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-fg-muted">You’re all caught up.</p>
          ) : (
            <ul className="divide-y divide-border" aria-label="Unread notifications">
              {items.map((n) => {
                const budget = budgetAlertInfo(n);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted',
                        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                      )}
                    >
                      {budget ? (
                        budget.level === 'exceeded' ? (
                          <TriangleAlert
                            className="mt-0.5 size-4 shrink-0 text-danger"
                            aria-hidden
                          />
                        ) : (
                          <Wallet className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                        )
                      ) : (
                        <span
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                          aria-hidden
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        {budget ? (
                          <Badge
                            variant={budget.level === 'exceeded' ? 'danger' : 'warning'}
                            className="mb-0.5 w-fit"
                            data-testid="notification-budget-badge"
                          >
                            {budget.label}
                          </Badge>
                        ) : null}
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-fg">{n.title}</span>
                          <time
                            dateTime={n.createdAt}
                            className="shrink-0 text-xs text-fg-subtle tabular"
                          >
                            {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                          </time>
                        </span>
                        {n.body ? (
                          <span className="line-clamp-2 text-xs text-fg-muted">{n.body}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
              {unread > items.length ? (
                <li className="px-4 py-2 text-center text-xs text-fg-subtle">
                  {unread - items.length} more unread
                </li>
              ) : null}
            </ul>
          )}
        </div>
        <div className="border-t border-border px-2 py-1.5">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            leadingIcon={<Settings2 aria-hidden />}
          >
            <Link href="/settings/profile#notifications" onClick={() => setOpen(false)}>
              Notification settings
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
