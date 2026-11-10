'use client';

import type { UserSummary } from '@hilatech/contracts';
import { Avatar, cn } from '@hilatech/ui';
import { fullName } from '@/lib/crm';
import { useT } from '@/i18n/provider';

/** Avatar + name for an assignee/owner/author; renders a muted "Unassigned" when null. */
export function UserChip({
  user,
  emptyLabel,
  size = 'xs',
  className,
  nameClassName,
}: {
  user: UserSummary | null | undefined;
  emptyLabel?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  nameClassName?: string;
}) {
  const t = useT();
  if (!user) {
    return (
      <span className={cn('inline-flex items-center gap-2 text-fg-subtle', className)}>
        <span
          aria-hidden
          className={cn(
            'inline-block rounded-full border border-dashed border-border-strong',
            size === 'xs' ? 'size-6' : size === 'sm' ? 'size-7' : 'size-8',
          )}
        />
        <span className={cn('truncate text-sm', nameClassName)}>
          {emptyLabel ?? t('common.unassigned')}
        </span>
      </span>
    );
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <Avatar
        size={size}
        src={user.avatarUrl}
        firstName={user.firstName}
        lastName={user.lastName}
      />
      <span className={cn('truncate text-sm', nameClassName)}>{fullName(user)}</span>
    </span>
  );
}
