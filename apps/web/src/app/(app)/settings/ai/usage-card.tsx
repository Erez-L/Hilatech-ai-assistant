'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Meter,
  SegmentedControl,
  Skeleton,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hilatech/ui';
import type { AiUsageSummary } from '@hilatech/contracts';
import { useAiUsageSummary } from '@/hooks/queries';
import { formatUsd } from '@/lib/ai';
import { QueryState } from '@/components/common/query-state';
import { PROVIDER_LABELS } from './provider-dialog';
import { useT, useFormat } from '@/i18n/provider';

type Period = 'month' | '7d' | '30d';

/** `month` sends no range (the API defaults to the current UTC month). */
export function rangeFor(period: Period, now = new Date()): { from?: string; to?: string } {
  if (period === 'month') return {};
  const days = period === '7d' ? 7 : 30;
  const to = new Date(now);
  to.setUTCMilliseconds(0);
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function UsageCard() {
  const t = useT();
  const [period, setPeriod] = React.useState<Period>('month');
  // Stable across renders so the query key does not change every tick.
  const range = React.useMemo(() => rangeFor(period), [period]);
  const usage = useAiUsageSummary(range);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('settings.usage')}</CardTitle>
          <CardDescription>{t('settings.modelCallsMadeByThe')}</CardDescription>
        </div>
        <SegmentedControl
          aria-label={t('settings.usagePeriod')}
          size="sm"
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: 'month', label: t('settings.thisMonth') },
            { value: '7d', label: t('settings.n7Days') },
            { value: '30d', label: t('settings.n30Days') },
          ]}
        />
      </CardHeader>
      <CardContent>
        <QueryState
          query={usage}
          compact
          errorTitle={t('settings.usageCouldnTBeLoaded')}
          loading={
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          }
        >
          {(summary) => <UsageBody summary={summary} />}
        </QueryState>
      </CardContent>
    </Card>
  );
}

export function UsageBody({ summary }: { summary: AiUsageSummary }) {
  const fmt = useFormat();
  const t = useT();
  const { limit } = summary;
  const ratio = limit.tokens ? limit.used / limit.tokens : 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('common.requests')}
          value={summary.requests}
          hint={t('settings.failed', { errorCount: summary.errorCount })}
        />
        <StatCard
          label={t('common.tokens')}
          value={summary.totalTokens}
          hint={t('common.inOut', {
            formatCompact: fmt.compact(summary.inputTokens),
            formatCompact2: fmt.compact(summary.outputTokens),
          })}
        />
        <StatCard
          label={t('common.estimatedCost')}
          value={summary.estimatedCostUsd == null ? '—' : formatUsd(summary.estimatedCostUsd, fmt)}
          hint={summary.estimatedCostUsd == null ? t('common.noPricingConfigured') : undefined}
        />
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-5 py-4 shadow-xs">
          <p className="text-sm text-fg-muted">{t('settings.planTokenLimit')}</p>
          {limit.tokens == null ? (
            <p className="text-sm">
              <span className="font-medium tabular">{fmt.number(limit.used)}</span>{' '}
              {t('settings.usedNoLimitOnThis')}
            </p>
          ) : (
            <>
              <p className="text-sm">
                <bdi dir="ltr" className="font-medium tabular">
                  {fmt.number(limit.used)}
                </bdi>
                <span className="text-fg-subtle">
                  {' '}
                  / <bdi dir="ltr">{fmt.number(limit.tokens)}</bdi>
                </span>
                <span className="ms-2 text-xs text-fg-subtle tabular">
                  <bdi dir="ltr">{Math.round(ratio * 100)}%</bdi>
                </span>
              </p>
              <Meter label={t('settings.planTokenUsage')} value={limit.used} max={limit.tokens} />
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="usage-by-model" className="flex flex-col gap-2">
          <h3 id="usage-by-model" className="text-sm font-semibold">
            {t('common.byModel')}
          </h3>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.model')}</TableHead>
                  <TableHead className="text-end">{t('common.requests')}</TableHead>
                  <TableHead className="text-end">{t('common.tokens')}</TableHead>
                  <TableHead className="text-end">{t('common.cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byModel.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-fg-muted">
                      {t('settings.noRequestsInThisPeriod')}
                    </TableCell>
                  </TableRow>
                ) : (
                  summary.byModel.map((m) => (
                    <TableRow key={`${m.provider}:${m.model}`}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-mono text-xs">{m.model}</span>
                          <span className="text-2xs text-fg-subtle">
                            {PROVIDER_LABELS[m.provider]}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-end tabular">{fmt.number(m.requests)}</TableCell>
                      <TableCell className="text-end tabular">
                        {fmt.number(m.inputTokens + m.outputTokens)}
                      </TableCell>
                      <TableCell className="text-end tabular">
                        {formatUsd(m.estimatedCostUsd, fmt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <section aria-labelledby="usage-by-agent" className="flex flex-col gap-2">
          <h3 id="usage-by-agent" className="text-sm font-semibold">
            {t('common.byAgent')}
          </h3>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.agent')}</TableHead>
                  <TableHead className="text-end">{t('common.requests')}</TableHead>
                  <TableHead className="text-end">{t('common.tokens')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byAgent.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-fg-muted">
                      {t('settings.noRequestsInThisPeriod')}
                    </TableCell>
                  </TableRow>
                ) : (
                  summary.byAgent.map((a) => (
                    <TableRow key={a.agentId ?? 'assistant'}>
                      <TableCell>
                        {a.agentName ??
                          (a.agentId ? t('common.deletedAgent') : t('settings.assistantOther'))}
                      </TableCell>
                      <TableCell className="text-end tabular">{fmt.number(a.requests)}</TableCell>
                      <TableCell className="text-end tabular">
                        {fmt.number(a.totalTokens)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}
