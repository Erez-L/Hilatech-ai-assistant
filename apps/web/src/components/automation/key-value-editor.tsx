'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { Button, IconButton, Input } from '@hilatech/ui';
import { useT } from '@/i18n/provider';

interface Row {
  id: number;
  key: string;
  value: string;
}

/**
 * Editable list of key/value pairs that reports a record (rows with an empty key are dropped).
 * Rows are kept locally so half-typed or duplicate keys don't jump around while typing.
 */
export function KeyValueEditor({
  idPrefix,
  label,
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
}: {
  idPrefix: string;
  label: string;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
}) {
  const t = useT();
  const [rows, setRows] = React.useState<Row[]>(() =>
    Object.entries(value).map(([key, v], id) => ({ id, key, value: v })),
  );
  const [nextId, setNextId] = React.useState(() => Object.keys(value).length);

  const commit = (next: Row[]) => {
    setRows(next);
    const record: Record<string, string> = {};
    for (const row of next) if (row.key.trim()) record[row.key.trim()] = row.value;
    onChange(record);
  };

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      {rows.map((row, i) => (
        <div key={row.id} className="flex items-center gap-2">
          <Input
            id={`${idPrefix}-key-${i}`}
            aria-label={t('automation.name', { label, value: i + 1 })}
            value={row.key}
            placeholder={keyPlaceholder ?? t('automation.headerPlaceholder')}
            onChange={(e) =>
              commit(rows.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)))
            }
          />
          <Input
            id={`${idPrefix}-value-${i}`}
            aria-label={t('automation.value', { label, value: i + 1 })}
            value={row.value}
            placeholder={valuePlaceholder ?? t('automation.valuePlaceholder')}
            onChange={(e) =>
              commit(rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)))
            }
          />
          <IconButton
            size="sm"
            label={t('automation.remove', { name: label.toLowerCase(), value: i + 1 })}
            onClick={() => commit(rows.filter((r) => r.id !== row.id))}
          >
            <X aria-hidden />
          </IconButton>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leadingIcon={<Plus aria-hidden />}
          onClick={() => {
            setRows([...rows, { id: nextId, key: '', value: '' }]);
            setNextId(nextId + 1);
          }}
        >
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
