'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { useUiStrings } from '../lib/ui-strings';

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Optional page-size control. */
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  itemLabel?: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  itemLabel,
  className,
  ...props
}: PaginationProps) {
  const ui = useUiStrings();
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label={ui.pagination}
      className={cn(
        'flex flex-col gap-3 text-sm text-fg-muted sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      {...props}
    >
      <p className="tabular">
        {total === 0
          ? ui.noItems(itemLabel ?? ui.items)
          : ui.itemsRange(start, end, total, itemLabel ?? ui.items)}
      </p>
      <div className="flex items-center gap-3">
        {pageSizeOptions && onPageSizeChange ? (
          <label className="flex items-center gap-2">
            <span className="text-xs">{ui.rows}</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 rounded-sm border border-border bg-surface px-2 text-xs text-fg focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            aria-label={ui.previousPage}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="min-w-[5.5rem] text-center text-xs tabular">
            {ui.pageOf(page, totalPages)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-label={ui.nextPage}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  );
}
