'use client';

import * as React from 'react';
import { ChevronDown, UserRoundCheck, UserRoundX } from 'lucide-react';
import { Permission, type UserSummary } from '@hilatech/contracts';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@hilatech/ui';
import { useMembers } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { useSession } from '@/stores/session';
import { fullName } from '@/lib/crm';
import { UserChip } from './user-chip';
import { useT } from '@/i18n/provider';

export interface AssigneeMenuProps {
  assignee: UserSummary | null;
  onAssign: (userId: string | null) => void;
  /** leads:assign / conversations:assign — may assign to anyone or clear the assignee. */
  canAssign: boolean;
  /** Members without the assign permission may still take a record themselves (API allows self-assign). */
  canSelfAssign?: boolean;
  pending?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  /** Accessible label for the trigger. */
  label?: string;
}

/**
 * Assignment control shared by leads and conversations: "Assign to me", "Unassign" and the list of
 * active members (when the role may read members).
 */
export function AssigneeMenu({
  assignee,
  onAssign,
  canAssign,
  canSelfAssign = false,
  pending,
  size = 'md',
  className,
  label,
}: AssigneeMenuProps) {
  const t = useT();
  const me = useSession((s) => s.user);
  const canReadMembers = useCan(Permission.MEMBERS_READ);
  const [open, setOpen] = React.useState(false);
  const members = useMembers({ page: 1, pageSize: 100 });
  const active = (members.data?.data ?? []).filter((m) => m.status === 'active');

  const selfOnly = !canAssign && canSelfAssign && !!me && assignee?.id !== me.id;
  if (!canAssign && !selfOnly) {
    return <UserChip user={assignee} className={className} />;
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size={size}
          loading={pending}
          aria-label={t('crm.assigneeAria', {
            label: label ?? t('common.assignee'),
            value: assignee ? fullName(assignee) : t('crm.unassignedLower'),
          })}
          className={cn('max-w-56 justify-between', className)}
          trailingIcon={<ChevronDown aria-hidden />}
        >
          <UserChip user={assignee} nameClassName="font-medium" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {me && assignee?.id !== me.id ? (
          <DropdownMenuItem onSelect={() => onAssign(me.id)}>
            <UserRoundCheck aria-hidden />
            {t('crm.assignToMe')}
          </DropdownMenuItem>
        ) : null}
        {assignee && canAssign ? (
          <DropdownMenuItem onSelect={() => onAssign(null)}>
            <UserRoundX aria-hidden />
            {t('crm.unassign')}
          </DropdownMenuItem>
        ) : null}
        {canAssign && canReadMembers && active.length > 0 ? (
          <>
            {(me && assignee?.id !== me.id) || assignee ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{t('common.team')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={assignee?.id ?? ''}
              onValueChange={(id) => {
                if (id !== assignee?.id) onAssign(id);
              }}
            >
              <div className="max-h-64 overflow-y-auto scrollbar-thin">
                {active.map((m) => (
                  <DropdownMenuRadioItem key={m.userId} value={m.userId}>
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar
                        size="xs"
                        src={m.user.avatarUrl}
                        firstName={m.user.firstName}
                        lastName={m.user.lastName}
                      />
                      <span className="truncate">{fullName(m.user)}</span>
                      {m.userId === me?.id ? (
                        <span className="text-xs text-fg-subtle">{t('common.you')}</span>
                      ) : null}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </div>
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
