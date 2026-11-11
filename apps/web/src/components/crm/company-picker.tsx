'use client';

import * as React from 'react';
import type { Company } from '@hilatech/contracts';
import { Combobox, type ComboboxItem } from '@hilatech/ui';
import { useCompanies } from '@/hooks/sales';
import { useDebouncedValue } from './use-debounced';
import { useT } from '@/i18n/provider';

export interface CompanyPickerProps {
  id?: string;
  value: string | null;
  onValueChange: (id: string | null, company: Company | null) => void;
  /** Known name for the current value, shown before any search. */
  selectedLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  footer?: React.ReactNode;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

/** Searches companies as you type (GET /companies?search=). */
export function CompanyPicker({
  id,
  value,
  onValueChange,
  selectedLabel,
  placeholder,
  disabled,
  clearable = true,
  footer,
  ...aria
}: CompanyPickerProps) {
  const t = useT();
  const [search, setSearch] = React.useState('');
  const debounced = useDebouncedValue(search);
  const query = useCompanies({ search: debounced || undefined, page: 1, pageSize: 10 });
  const companies = React.useMemo(() => query.data?.data ?? [], [query.data]);
  const items: ComboboxItem[] = React.useMemo(
    () => companies.map((c) => ({ value: c.id, label: c.name, description: c.domain ?? undefined })),
    [companies],
  );
  return (
    <Combobox
      id={id}
      items={items}
      value={value}
      selectedLabel={selectedLabel}
      onValueChange={(next) => onValueChange(next, companies.find((c) => c.id === next) ?? null)}
      search={search}
      onSearchChange={setSearch}
      loading={query.isFetching}
      placeholder={placeholder ?? t('companies.searchCompanies')}
      searchPlaceholder={t('companies.typeACompanyNameOrDomain')}
      emptyMessage={
        query.isError
          ? t('companies.companiesCouldNotLoad')
          : debounced
            ? t('companies.noCompaniesMatch')
            : t('companies.noCompaniesYet')
      }
      disabled={disabled}
      clearable={clearable}
      footer={footer}
      {...aria}
    />
  );
}
