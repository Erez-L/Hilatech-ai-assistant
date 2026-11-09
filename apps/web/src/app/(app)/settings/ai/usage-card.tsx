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
  formatCompact,
} from '@hilatech/ui';
import type { AiUsageSummary } from '@hilatech/contracts';
import { useAiUsageSummary } from '@/hooks/queries';
import { formatUsd } from '@/lib/ai';
import { QueryState } from '@/components/common/query-state';
import { PROVIDER_LABELS } from './provider-dialog';

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
  const [period, setPeriod] = React.useState<Period>('month');
  // Stable across renders so the query key does not change every tick.
  const range = React.useMemo(() => rangeFor(period), [period]);
  const usage = useAiUsageSummary(range);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>Usage</CardTitle>
          <CardDescription>
            Model calls made by the assistant and agents. Costs are estimates and only shown when a
            price is configured for the model.
          </CardDescription>
        </div>
        <SegmentedControl
          aria-label="Usage period"
          size="sm"
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: 'month', label: 'This month' },
            { value: '7d', label: '7 days' },
            { value: '30d', label: '30 days' },
          ]}
        />
      </CardHeader>
      <CardContent>
        <QueryState
          query={usage}
          compact
          errorTitle="Usage couldn’t be loaded"
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
  const { limit } = summary;
  const ratio = limit.tokens ? limit.used / limit.tokens : 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Requests" value={summary.requests} hint={`${summary.errorCount} failed`} />
        <StatCard
          label="Tokens"
          value={summary.totalTokens}
          hint={`${formatCompact(summary.inputTokens)} in · ${formatCompact(summary.outputTokens)} out`}
        />
        <StatCard
          label="Estimated cost"
          value={summary.estimatedCostUsd == null ? '—' : formatUsd(summary.estimatedCostUsd)}
          hint={summary.estimatedCostUsd == null ? 'No pricing configured' : undefined}
        />
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-5 py-4 shadow-xs">
          <p className="text-sm text-fg-muted">Plan token limit</p>
          {limit.tokens == null ? (
            <p className="text-sm">
              <span className="font-medium tabular">{limit.used.toLocaleString('en')}</span> used ·
              no limit on this plan
            </p>
          ) : (
            <>
              <p className="text-sm">
                <span className="font-medium tabular">{limit.used.toLocaleString('en')}</span>
                <span className="text-fg-subtle"> / {limit.tokens.toLocaleString('en')}</span>
                <span className="ml-2 text-xs text-fg-subtle tabular">
                  {Math.round(ratio * 100)}%
                </span>
              </p>
              <Meter label="Plan token usage" value={limit.used} max={limit.tokens} />
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="usage-by-model" className="flex flex-col gap-2">
          <h3 id="usage-by-model" className="text-sm font-semibold">
            By model
          </h3>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byModel.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-fg-muted">
                      No requests in this period.
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
                      <TableCell className="text-right tabular">
                        {m.requests.toLocaleString('en')}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {(m.inputTokens + m.outputTokens).toLocaleString('en')}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {formatUsd(m.estimatedCostUsd)}
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
            By agent
          </h3>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byAgent.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-fg-muted">
                      No requests in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  summary.byAgent.map((a) => (
                    <TableRow key={a.agentId ?? 'assistant'}>
                      <TableCell>
                        {a.agentName ?? (a.agentId ? 'Deleted agent' : 'Assistant & other')}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {a.requests.toLocaleString('en')}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {a.totalTokens.toLocaleString('en')}
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
