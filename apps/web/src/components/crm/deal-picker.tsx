'use client';

import * as React from 'react';
import type { DealWithRelations } from '@hilatech/contracts';
import { Combobox, type ComboboxItem } from '@hilatech/ui';
import { useDeals } from '@/hooks/sales';
import { useDebouncedValue } from './use-debounced';
import { useFormat, useT } from '@/i18n/provider';

export interface DealPickerProps {
  id?: string;
  value: string | null;
  onValueChange: (id: string | null, deal: DealWithRelations | null) => void;
  selectedLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

/** Searches deals as you type (GET /deals?search=). */
export function DealPicker({
  id,
  value,
  onValueChange,
  selectedLabel,
  placeholder,
  disabled,
  clearable = true,
  ...aria
}: DealPickerProps) {
  const t = useT();
  const fmt = useFormat();
  const [search, setSearch] = React.useState('');
  const debounced = useDebouncedValue(search);
  const query = useDeals({
    search: debounced || undefined,
    page: 1,
    pageSize: 10,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  const deals = React.useMemo(() => query.data?.data ?? [], [query.data]);
  const items: ComboboxItem[] = React.useMemo(
    () =>
      deals.map((d) => ({
        value: d.id,
        label: d.title,
        description: [d.stage.name, d.value != null ? fmt.currency(d.value, d.currency) : null]
          .filter(Boolean)
          .join(' · '),
      })),
    [deals, fmt],
  );
  return (
    <Combobox
      id={id}
      items={items}
      value={value}
      selectedLabel={selectedLabel}
      onValueChange={(next) => onValueChange(next, deals.find((d) => d.id === next) ?? null)}
      search={search}
      onSearchChange={setSearch}
      loading={query.isFetching}
      placeholder={placeholder ?? t('deals.searchDeals')}
      searchPlaceholder={t('deals.typeADealTitle')}
      emptyMessage={
        query.isError
          ? t('deals.dealsCouldNotLoad')
          : debounced
            ? t('deals.noDealsMatch')
            : t('deals.noDealsYet')
      }
      disabled={disabled}
      clearable={clearable}
      {...aria}
    />
  );
}
