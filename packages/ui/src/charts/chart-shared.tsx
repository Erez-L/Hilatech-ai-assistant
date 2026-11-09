'use client';

import * as React from 'react';
import type { TooltipProps } from 'recharts';
import { cn } from '../lib/cn';
import { formatNumber } from '../lib/format';

/** Categorical series colours, in a fixed CVD-validated order (see styles.css --chart-*). */
export const CHART_SERIES_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
  'var(--color-chart-7)',
  'var(--color-chart-8)',
] as const;

export const CHART_GRID = 'var(--chart-grid)';
export const CHART_TEXT = 'var(--color-fg-muted)';
export const CHART_FONT_SIZE = 11;

export interface SeriesDef<K extends string = string> {
  key: K;
  label: string;
  /** Optional explicit colour (otherwise assigned by position). */
  color?: string;
}

export function seriesColor(index: number, override?: string): string {
  return override ?? CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]!;
}

export type ValueFormatter = (value: number) => string;

export interface ChartTooltipContentProps extends TooltipProps<number, string> {
  valueFormatter?: ValueFormatter;
  labelFormatter?: (label: string | number) => string;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  valueFormatter = formatNumber,
  labelFormatter,
}: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="min-w-[8rem] rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-fg shadow-popover">
      {label !== undefined ? (
        <p className="mb-1.5 font-medium text-fg">
          {labelFormatter ? labelFormatter(label) : String(label)}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {payload.map((entry) => (
          <li
            key={String(entry.dataKey ?? entry.name)}
            className="flex items-center justify-between gap-4"
          >
            <span className="flex items-center gap-1.5 text-fg-muted">
              <span
                className="size-2 rounded-full"
                style={{ background: entry.color }}
                aria-hidden
              />
              {entry.name}
            </span>
            <span className="font-medium tabular text-fg">
              {typeof entry.value === 'number'
                ? valueFormatter(entry.value)
                : String(entry.value ?? '—')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ChartLegendProps {
  items: { label: string; color: string; shape?: 'dot' | 'line' }[];
  className?: string;
}

export function ChartLegend({ items, className }: ChartLegendProps) {
  return (
    <ul
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted', className)}
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className={cn(item.shape === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2 rounded-full')}
            style={{ background: item.color }}
            aria-hidden
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export interface ChartFrameProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  legend?: React.ReactNode;
  height?: number;
  className?: string;
  children: React.ReactNode;
}

export function ChartFrame({
  title,
  description,
  legend,
  height = 240,
  className,
  children,
}: ChartFrameProps) {
  return (
    <figure className={cn('flex flex-col gap-3', className)}>
      {title || description || legend ? (
        <figcaption className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title ? <p className="text-sm font-medium text-fg">{title}</p> : null}
            {description ? <p className="text-xs text-fg-muted">{description}</p> : null}
          </div>
          {legend}
        </figcaption>
      ) : null}
      <div style={{ height }} className="w-full text-fg-muted">
        {children}
      </div>
    </figure>
  );
}
