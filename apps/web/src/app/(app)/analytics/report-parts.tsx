'use client';

import * as React from 'react';
import { Download, Info } from 'lucide-react';
import type { AnalyticsExportQuery, AnalyticsGranularity } from '@hilatech/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  cn,
  toast,
} from '@hilatech/ui';
import { analyticsApi, getErrorMessage, type AnalyticsRangeParams } from '@/lib/api';
import { DataTable, type Column } from '@/components/common/data-table';
import { pct, saveBlob } from '@/lib/analytics';
import { useT, useFormat } from '@/i18n/provider';

export { DataTable, type Column };

/** Everything a report tab needs to know about the selected window. */
export interface ReportContext {
  params: AnalyticsRangeParams;
  granularity: AnalyticsGranularity;
}

export function ReportSkeleton() {
  const t = useT();
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label={t('analytics.loadingReport')}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}

/** An honest note about something the API says it does not model or cannot price. */
export function ReportNote({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Alert tone="info" title={title} data-testid={testId} hideIcon={false}>
      {children}
    </Alert>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  flush = false,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  /** Remove body padding (tables). */
  flush?: boolean;
  className?: string;
}) {
  const headingId = React.useId();
  return (
    <Card className={className} role="region" aria-labelledby={headingId}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle id={headingId}>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent className={cn(flush && 'p-0')}>{children}</CardContent>
    </Card>
  );
}

/** Horizontal share bars for a small categorical breakdown (status, source, channel…). */
export function BreakdownList({
  label,
  items,
  emptyText,
}: {
  label: string;
  items: { key: string; label: string; count: number }[];
  emptyText?: string;
}) {
  const t = useT();
  const fmt = useFormat();
  const total = items.reduce((sum, i) => sum + i.count, 0);
  if (total === 0)
    return <p className="text-sm text-fg-muted">{emptyText ?? t('analytics.noDataInRange')}</p>;
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-fg-muted">{item.label}</span>
            <span className="font-medium tabular">
              {item.count}
              <span className="ms-1.5 text-xs font-normal text-fg-subtle">
                {pct(item.count / total, fmt)}
              </span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden>
            <div
              className="h-full rounded-full"
              style={{
                width: `${(item.count / total) * 100}%`,
                background: 'var(--color-chart-1)',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Downloads GET /analytics/export as a CSV through the authenticated client. */
export function ExportButtons({
  report,
  ctx,
  label,
}: {
  report: AnalyticsExportQuery['report'];
  ctx: ReportContext;
  label: string;
}) {
  const t = useT();
  const [busy, setBusy] = React.useState<'series' | 'breakdown' | null>(null);

  const run = async (section: 'series' | 'breakdown') => {
    setBusy(section);
    try {
      const file = await analyticsApi.exportCsv({ report, section, ...ctx.params });
      saveBlob(file.blob, file.filename);
      toast.success(t('analytics.downloaded', { filename: file.filename }));
    } catch (error) {
      toast.error(getErrorMessage(error, t('analytics.exportFailed')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label={t('analytics.export', { label })}
    >
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={<Download aria-hidden />}
        loading={busy === 'series'}
        disabled={busy !== null}
        aria-label={t('analytics.exportTimeSeriesAsCsv', { label: label.toLowerCase() })}
        onClick={() => void run('series')}
      >
        {t('analytics.exportCsvTimeSeries')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={<Download aria-hidden />}
        loading={busy === 'breakdown'}
        disabled={busy !== null}
        aria-label={t('analytics.exportBreakdownAsCsv', { label: label.toLowerCase() })}
        onClick={() => void run('breakdown')}
      >
        {t('analytics.exportCsvBreakdown')}
      </Button>
    </div>
  );
}

export function InlineHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-fg-muted">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Merge several count series (same bucket order) into chart rows keyed by `bucket`. */
export function mergeSeries(
  parts: { key: string; points: { bucket: string; count: number }[] }[],
): Record<string, string | number>[] {
  const rows = new Map<string, Record<string, string | number>>();
  for (const part of parts) {
    for (const p of part.points) {
      const row = rows.get(p.bucket) ?? { bucket: p.bucket };
      row[part.key] = p.count;
      rows.set(p.bucket, row);
    }
  }
  return [...rows.values()]
    .map((r) => {
      for (const part of parts) r[part.key] ??= 0;
      return r;
    })
    .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}
