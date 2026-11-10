'use client';

import { useT } from '@/i18n/provider';
import * as React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn } from '@hilatech/ui';

export interface Column<T> {
  header: string;
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
}

/** Small read-only table with an accessible name and a built-in empty row. */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  emptyText,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  emptyText?: string;
}) {
  const t = useT();
  return (
    <Table aria-label={caption}>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.header} className={c.align === 'right' ? 'text-end' : undefined}>
              {c.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="py-6 text-center text-fg-muted">
              {emptyText ?? t('common.nothingToShowForRange')}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row, i) => (
            <TableRow key={rowKey(row, i)}>
              {columns.map((c) => (
                <TableCell
                  key={c.header}
                  className={cn('tabular', c.align === 'right' && 'text-end')}
                >
                  {c.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
