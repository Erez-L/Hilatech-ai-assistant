'use client';

import * as React from 'react';
import { Permission } from '@hilatech/contracts';
import { Input, NativeSelect } from '@hilatech/ui';
import { useAgents, useMembers } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';

interface PickerProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Agent picker. Falls back to a plain id field when the session cannot list agents. */
export function AgentPicker({ id, value, onChange, invalid, disabled, ...rest }: PickerProps) {
  const canRead = useCan(Permission.AGENTS_READ);
  const agents = useAgents({ pageSize: 100 }, { enabled: canRead });
  if (!canRead || agents.isError) {
    return (
      <Input
        id={id}
        value={value}
        invalid={invalid}
        disabled={disabled}
        placeholder="Agent id (uuid)"
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    );
  }
  const list = agents.data?.data ?? [];
  return (
    <NativeSelect
      id={id}
      value={value}
      invalid={invalid}
      disabled={disabled || agents.isPending}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    >
      <option value="">{agents.isPending ? 'Loading agents…' : 'Choose an agent'}</option>
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.isEnabled ? '' : ' (disabled)'}
        </option>
      ))}
      {value && !list.some((a) => a.id === value) ? <option value={value}>{value}</option> : null}
    </NativeSelect>
  );
}

/** Organization member picker (value = user id). Falls back to a plain id field without `members:read`. */
export function UserPicker({ id, value, onChange, invalid, disabled, ...rest }: PickerProps) {
  const canRead = useCan(Permission.MEMBERS_READ);
  const members = useMembers({ pageSize: 100 });
  if (!canRead || members.isError) {
    return (
      <Input
        id={id}
        value={value}
        invalid={invalid}
        disabled={disabled}
        placeholder="User id (uuid)"
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    );
  }
  const list = (members.data?.data ?? []).filter((m) => m.status === 'active');
  return (
    <NativeSelect
      id={id}
      value={value}
      invalid={invalid}
      disabled={disabled || members.isPending}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    >
      <option value="">{members.isPending ? 'Loading members…' : 'Choose a person'}</option>
      {list.map((m) => (
        <option key={m.userId} value={m.userId}>
          {`${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email} ({m.user.email})
        </option>
      ))}
      {value && !list.some((m) => m.userId === value) ? (
        <option value={value}>{value}</option>
      ) : null}
    </NativeSelect>
  );
}
