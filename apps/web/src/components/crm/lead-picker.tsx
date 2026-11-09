'use client';

import * as React from 'react';
import type { LeadWithRelations } from '@hilatech/contracts';
import { Combobox, type ComboboxItem } from '@hilatech/ui';
import { useLeads } from '@/hooks/queries';
import { LEAD_STATUS_LABELS, contactName } from '@/lib/crm';

export interface LeadPickerProps {
  id?: string;
  value: string | null;
  onValueChange: (id: string | null, lead: LeadWithRelations | null) => void;
  /** Known title for the current value, shown before any search. */
  selectedLabel?: string;
  /** Restrict the search to leads of one contact. */
  contactId?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
}

/** Searches leads as you type (GET /leads?search=). */
export function LeadPicker({
  id,
  value,
  onValueChange,
  selectedLabel,
  contactId,
  placeholder = 'Search leads',
  disabled,
  clearable = true,
  ...aria
}: LeadPickerProps) {
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const query = useLeads({
    search: debounced || undefined,
    contactId,
    page: 1,
    pageSize: 10,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  const leads = React.useMemo(() => query.data?.data ?? [], [query.data]);
  const items: ComboboxItem[] = React.useMemo(
    () =>
      leads.map((l) => ({
        value: l.id,
        label: l.title,
        description: [LEAD_STATUS_LABELS[l.status], l.contact ? contactName(l.contact) : null]
          .filter(Boolean)
          .join(' · '),
      })),
    [leads],
  );

  return (
    <Combobox
      id={id}
      items={items}
      value={value}
      selectedLabel={selectedLabel}
      onValueChange={(next) => onValueChange(next, leads.find((l) => l.id === next) ?? null)}
      search={search}
      onSearchChange={setSearch}
      loading={query.isFetching}
      placeholder={placeholder}
      searchPlaceholder="Type a lead title"
      emptyMessage={
        query.isError
          ? 'Leads could not be loaded.'
          : debounced
            ? 'No leads match.'
            : 'No leads yet.'
      }
      disabled={disabled}
      clearable={clearable}
      {...aria}
    />
  );
}
