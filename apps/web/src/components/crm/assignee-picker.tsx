'use client';

import * as React from 'react';
import { NativeSelect } from '@hilatech/ui';
import { useMembers } from '@/hooks/queries';
import { useSession } from '@/stores/session';
import { fullName } from '@/lib/crm';

export interface AssigneePickerProps {
  id?: string;
  value: string | null;
  onValueChange: (userId: string | null) => void;
  emptyLabel?: string;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
}

/** Form-friendly member select (assignee / owner). Lists active members from GET /members. */
export function AssigneePicker({
  id,
  value,
  onValueChange,
  emptyLabel = 'Unassigned',
  disabled,
  ...aria
}: AssigneePickerProps) {
  const me = useSession((s) => s.user);
  const members = useMembers({ page: 1, pageSize: 100 });
  const active = React.useMemo(
    () => (members.data?.data ?? []).filter((m) => m.status === 'active'),
    [members.data],
  );
  // Keep the current value selectable even if it is not among the loaded members.
  const missing = value && !active.some((m) => m.userId === value);

  return (
    <NativeSelect
      id={id}
      value={value ?? ''}
      disabled={disabled || members.isPending}
      onChange={(e) => onValueChange(e.target.value || null)}
      aria-describedby={aria['aria-describedby']}
      aria-invalid={aria['aria-invalid']}
      aria-required={aria['aria-required']}
    >
      <option value="">{members.isPending ? 'Loading members…' : emptyLabel}</option>
      {active.map((m) => (
        <option key={m.userId} value={m.userId}>
          {fullName(m.user)}
          {m.userId === me?.id ? ' (you)' : ''}
        </option>
      ))}
      {missing ? <option value={value}>Former member</option> : null}
    </NativeSelect>
  );
}
