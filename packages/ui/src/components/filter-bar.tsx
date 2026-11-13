'use client';

import * as React from 'react';
import { FilterX, SlidersHorizontal } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';

export interface FilterBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The search field. Always visible, on every screen size. */
  search?: React.ReactNode;
  /** The other filter fields (each one a labelled control). */
  children?: React.ReactNode;
  /** How many of the filters in `children` are set — shown on the mobile "Filters" button. */
  activeCount?: number;
  /** Clears every filter, the search included. The button is disabled when `canClear` is false. */
  onClear?: () => void;
  canClear?: boolean;
  labels: { filters: string; clear: string };
  /** Grid template for the filter fields from the `md` breakpoint up. */
  columnsClassName?: string;
}

/**
 * The filter area above a list. On wide screens the search and all filters sit in one row. On narrow screens
 * only the search and a "Filters (n)" button stay above the list; the button reveals the remaining filters, so
 * a phone does not open on a wall of form fields.
 */
export function FilterBar({
  search,
  children,
  activeCount = 0,
  onClear,
  canClear = true,
  labels,
  columnsClassName = 'md:grid-cols-2 xl:grid-cols-4',
  className,
  ...props
}: FilterBarProps) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const hasFilters = React.Children.count(children) > 0;

  return (
    <div className={cn('flex flex-col gap-4', className)} {...props}>
      <div className="flex items-end gap-2">
        {search ? <div className="min-w-0 flex-1">{search}</div> : null}
        {hasFilters ? (
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 md:hidden"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            leadingIcon={<SlidersHorizontal aria-hidden />}
          >
            {labels.filters}
            {activeCount > 0 ? (
              <span className="ms-1 inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-2xs font-semibold text-accent-fg tabular">
                {activeCount}
              </span>
            ) : null}
          </Button>
        ) : null}
        {onClear ? (
          <Button
            type="button"
            variant="ghost"
            className="hidden shrink-0 md:inline-flex"
            onClick={onClear}
            disabled={!canClear}
            leadingIcon={<FilterX aria-hidden />}
          >
            {labels.clear}
          </Button>
        ) : null}
      </div>
      {hasFilters ? (
        <div
          id={panelId}
          className={cn('gap-4 md:grid', columnsClassName, open ? 'grid' : 'hidden')}
        >
          {children}
          {onClear ? (
            <Button
              type="button"
              variant="ghost"
              className="justify-self-start md:hidden"
              onClick={onClear}
              disabled={!canClear}
              leadingIcon={<FilterX aria-hidden />}
            >
              {labels.clear}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
