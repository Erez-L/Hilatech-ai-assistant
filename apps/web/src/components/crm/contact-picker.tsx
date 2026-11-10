'use client';

import * as React from 'react';
import type { Contact, ContactSummary } from '@hilatech/contracts';
import { Combobox, type ComboboxItem } from '@hilatech/ui';
import { useContacts } from '@/hooks/queries';
import { contactMeta, contactName } from '@/lib/crm';
import { useT } from '@/i18n/provider';

export interface ContactPickerProps {
  id?: string;
  value: string | null;
  onValueChange: (id: string | null, contact: ContactSummary | null) => void;
  /** Already-known contact for the current value (shows its name before any search). */
  selected?: ContactSummary | null;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  footer?: React.ReactNode;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
}

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function toSummary(c: Contact): ContactSummary {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    company: c.company,
  };
}

/** Searches contacts as you type (GET /contacts?search=). */
export function ContactPicker({
  id,
  value,
  onValueChange,
  selected,
  placeholder,
  disabled,
  clearable = true,
  footer,
  ...aria
}: ContactPickerProps) {
  const t = useT();
  const [search, setSearch] = React.useState('');
  const debounced = useDebounced(search);
  const query = useContacts({ search: debounced || undefined, page: 1, pageSize: 10 });
  const contacts = React.useMemo(() => query.data?.data ?? [], [query.data]);

  const items: ComboboxItem[] = React.useMemo(
    () =>
      contacts.map((c) => ({
        value: c.id,
        label: contactName(c),
        description: contactMeta(c) ?? undefined,
      })),
    [contacts],
  );

  return (
    <Combobox
      id={id}
      items={items}
      value={value}
      selectedLabel={selected ? contactName(selected) : undefined}
      onValueChange={(next) => {
        const found = contacts.find((c) => c.id === next);
        onValueChange(next, found ? toSummary(found) : null);
      }}
      search={search}
      onSearchChange={setSearch}
      loading={query.isFetching}
      placeholder={placeholder ?? t('crm.searchContacts')}
      searchPlaceholder={t('crm.typeANameEmailOr')}
      emptyMessage={
        query.isError
          ? t('crm.contactsCouldNotLoad')
          : debounced
            ? t('crm.noContactsMatch')
            : t('crm.noContactsYet')
      }
      disabled={disabled}
      clearable={clearable}
      footer={footer}
      {...aria}
    />
  );
}
