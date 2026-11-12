import * as React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatCompact } from '../lib/format';
import { Skeleton } from './skeleton';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: number | string | null | undefined;
  /** Optional signed delta (e.g. 0.12 for +12%) relative to a named period. */
  delta?: number | null;
  deltaLabel?: string;
  /** Whether an increase is good (controls the delta colour). */
  upIsGood?: boolean;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  loading?: boolean;
}

/** Stat tile: label · value (compact) · optional delta. Numbers use tabular figures. */
export function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  upIsGood = true,
  hint,
  icon,
  loading,
  className,
  ...props
}: StatCardProps) {
  const display = typeof value === 'number' ? formatCompact(value) : (value ?? '—');
  const deltaGood = delta != null && delta >= 0 === upIsGood;
  return (
    <div
      className={cn(
        'stat-card flex animate-rise flex-col gap-3 rounded-lg border border-border bg-surface px-5 py-4 shadow-xs',
        'transition-[translate,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-popover',
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">{label}</p>
        {icon ? (
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-tone-soft text-tone-fg [&_svg]:size-4"
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <p className="text-[1.875rem] leading-none font-extrabold tracking-tight tabular text-fg">
          {display}
        </p>
      )}
      {delta != null || hint ? (
        <div className="flex items-center gap-2 text-xs">
          {delta != null ? (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium tabular',
                deltaGood ? 'text-success' : 'text-danger',
              )}
            >
              {delta >= 0 ? (
                <ArrowUpRight className="size-3.5" aria-hidden />
              ) : (
                <ArrowDownRight className="size-3.5" aria-hidden />
              )}
              {Math.abs(delta * 100).toFixed(0)}%
            </span>
          ) : null}
          {deltaLabel ? <span className="text-fg-subtle">{deltaLabel}</span> : null}
          {hint ? <span className="font-medium text-tone-fg">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
