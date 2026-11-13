'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '../lib/cn';
import { Skeleton } from './skeleton';

export const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(function Table({ className, ...props }, ref) {
  return (
    <div className="relative w-full overflow-x-auto scrollbar-thin">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
});

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableHeader({ className, ...props }, ref) {
  return (
    <thead
      ref={ref}
      className={cn('bg-surface-muted/70 [&_tr]:border-b [&_tr]:border-border', className)}
      {...props}
    />
  );
});

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableBody({ className, ...props }, ref) {
  return <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
});

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableFooter({ className, ...props }, ref) {
  return (
    <tfoot
      ref={ref}
      className={cn('border-t border-border bg-surface-muted/60 font-medium', className)}
      {...props}
    />
  );
});

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(function TableRow({ className, ...props }, ref) {
  return (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border transition-colors hover:bg-tone-soft/50 data-[state=selected]:bg-tone-soft',
        className,
      )}
      {...props}
    />
  );
});

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(function TableHead({ className, ...props }, ref) {
  return (
    <th
      ref={ref}
      scope="col"
      className={cn(
        'h-10 px-3 text-start align-middle text-xs font-semibold whitespace-nowrap text-fg-muted first:ps-5 last:pe-5',
        className,
      )}
      {...props}
    />
  );
});

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(function TableCell({ className, ...props }, ref) {
  return (
    <td
      ref={ref}
      className={cn('px-3 py-3 align-middle first:ps-5 last:pe-5', className)}
      {...props}
    />
  );
});

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K;
  direction: SortDirection;
}

export interface SortableHeadProps<K extends string> extends Omit<
  React.ThHTMLAttributes<HTMLTableCellElement>,
  'onChange'
> {
  sortKey: K;
  sort: SortState<K> | null;
  onSortChange: (next: SortState<K>) => void;
  children: React.ReactNode;
}

/** Column header that toggles asc/desc, with aria-sort for assistive technology. */
export function SortableHead<K extends string>({
  sortKey,
  sort,
  onSortChange,
  children,
  className,
  ...props
}: SortableHeadProps<K>) {
  const active = sort?.key === sortKey;
  const direction = active ? sort.direction : undefined;
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('p-0 first:ps-2 last:pe-2', className)}
      {...props}
    >
      <button
        type="button"
        onClick={() =>
          onSortChange({ key: sortKey, direction: active && direction === 'asc' ? 'desc' : 'asc' })
        }
        className={cn(
          'inline-flex h-10 items-center gap-1 rounded-xs px-3 text-xs font-medium hover:text-fg',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
          active ? 'text-fg' : 'text-fg-muted',
        )}
      >
        {children}
        <Icon className={cn('size-3.5', active ? 'text-tone' : 'text-fg-subtle')} aria-hidden />
      </button>
    </TableHead>
  );
}

export interface TableEmptyRowProps {
  colSpan: number;
  children: React.ReactNode;
  className?: string;
}

/** Full-width row used for empty / error / loading states inside a table body. */
export function TableEmptyRow({ colSpan, children, className }: TableEmptyRowProps) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn('px-5 py-10 text-center text-sm text-fg-muted', className)}
      >
        {children}
      </td>
    </tr>
  );
}

export interface TableSkeletonRowsProps {
  rows?: number;
  columns: number;
}

export function TableSkeletonRows({ rows = 5, columns }: TableSkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r} aria-hidden>
          {Array.from({ length: columns }).map((__, c) => (
            <TableCell key={c}>
              <Skeleton className={cn('h-4', c === 0 ? 'w-40' : 'w-24')} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/** Sort an array client-side by a SortState using a key accessor. */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K> | null,
  accessor: (row: T, key: K) => string | number | boolean | null | undefined,
): T[] {
  if (!sort) return [...rows];
  const dir = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = accessor(a, sort.key);
    const bv = accessor(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir;
  });
}
