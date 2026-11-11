'use client';

import * as React from 'react';
import type { ConversationWithRelations } from '@hilatech/contracts';
import { Combobox, type ComboboxItem } from '@hilatech/ui';
import { useConversations } from '@/hooks/queries';
import { contactName } from '@/lib/crm';
import { useDebouncedValue } from './use-debounced';
import { useT } from '@/i18n/provider';

export interface ConversationPickerProps {
  id?: string;
  value: string | null;
  onValueChange: (id: string | null, conversation: ConversationWithRelations | null) => void;
  selectedLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

/** Searches conversations as you type (GET /conversations?search=). */
export function ConversationPicker({
  id,
  value,
  onValueChange,
  selectedLabel,
  placeholder,
  disabled,
  clearable = true,
  ...aria
}: ConversationPickerProps) {
  const t = useT();
  const [search, setSearch] = React.useState('');
  const debounced = useDebouncedValue(search);
  const query = useConversations({ search: debounced || undefined, page: 1, pageSize: 10 });
  const conversations = React.useMemo(() => query.data?.data ?? [], [query.data]);
  const items: ComboboxItem[] = React.useMemo(
    () =>
      conversations.map((c) => ({
        value: c.id,
        label: c.subject || t('common.noSubject'),
        description: c.contact ? contactName(c.contact) : undefined,
      })),
    [conversations, t],
  );
  return (
    <Combobox
      id={id}
      items={items}
      value={value}
      selectedLabel={selectedLabel}
      onValueChange={(next) =>
        onValueChange(next, conversations.find((c) => c.id === next) ?? null)
      }
      search={search}
      onSearchChange={setSearch}
      loading={query.isFetching}
      placeholder={placeholder ?? t('tasks.searchConversations')}
      searchPlaceholder={t('tasks.typeASubject')}
      emptyMessage={
        query.isError
          ? t('tasks.conversationsCouldNotLoad')
          : debounced
            ? t('tasks.noConversationsMatch')
            : t('common.noConversationsYet')
      }
      disabled={disabled}
      clearable={clearable}
      {...aria}
    />
  );
}
