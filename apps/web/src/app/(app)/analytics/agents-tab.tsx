'use client';

import { Bot } from 'lucide-react';
import { AreaChart, EmptyState, StatCard } from '@hilatech/ui';
import { useAgentAnalytics } from '@/hooks/analytics';
import { QueryState } from '@/components/common/query-state';
import { bucketLabel, formatDuration, formatUsd, pct, recordToRows } from '@/lib/analytics';
import {
  BreakdownList,
  DataTable,
  ReportNote,
  ReportSkeleton,
  SectionCard,
  type ReportContext,
} from './report-parts';
import { useT, useFormat } from '@/i18n/provider';

export function AgentsTab({ ctx }: { ctx: ReportContext }) {
  const fmt = useFormat();
  const t = useT();
  const query = useAgentAnalytics(ctx.params);
  return (
    <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle={t('analytics.agentAnalyticsCouldnTBe')}
      >
        {(d) => {
          const totals = d.totals;
          const costNote = !d.pricingConfigured
            ? t('analytics.noModelPricing')
            : totals.costCoverage.priced < totals.costCoverage.total
              ? t('analytics.costCoverage', {
                  priced: totals.costCoverage.priced,
                  total: totals.costCoverage.total,
                })
              : null;
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label={t('common.runs')}
                  value={totals.executions}
                  hint={t('analytics.succeededFailed', {
                    succeeded: totals.succeeded,
                    failed: totals.failed,
                  })}
                />
                <StatCard
                  label={t('analytics.successRate')}
                  value={pct(totals.successRate, fmt)}
                  hint={
                    totals.successRate == null
                      ? t('analytics.noFinishedRuns')
                      : t('analytics.succeededFinished')
                  }
                />
                <StatCard
                  label={t('analytics.medianDuration')}
                  value={formatDuration(totals.durationMs.p50, fmt)}
                  hint={`p95 ${formatDuration(totals.durationMs.p95, fmt)}`}
                />
                <StatCard
                  label={t('common.tokens')}
                  value={totals.totalTokens}
                  hint={t('common.inOut', {
                    formatCompact: fmt.compact(totals.inputTokens),
                    formatCompact2: fmt.compact(totals.outputTokens),
                  })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label={t('common.estimatedCost')}
                  value={formatUsd(totals.costUsd, fmt)}
                  hint={
                    totals.costUsd == null
                      ? t('analytics.notAvailable')
                      : t('analytics.runsPriced', {
                          priced: totals.costCoverage.priced,
                          total: totals.costCoverage.total,
                        })
                  }
                />
              </div>
              {costNote ? (
                <ReportNote
                  title={
                    d.pricingConfigured
                      ? t('analytics.partialCostCoverage')
                      : t('analytics.costIsNotAvailable')
                  }
                  testId="agents-cost-note"
                >
                  {costNote}
                </ReportNote>
              ) : null}

              {totals.executions === 0 ? (
                <EmptyState
                  icon={<Bot />}
                  title={t('analytics.noAgentRunsInThis')}
                  description={t('analytics.runsAppearHereOnceYour')}
                />
              ) : (
                <>
                  <SectionCard
                    title={t('analytics.runsOverTime')}
                    description={t('analytics.successfulAndFailedRunsPer')}
                  >
                    <AreaChart
                      data={d.series.map((p) => ({ ...p }))}
                      xKey="bucket"
                      height={240}
                      labelFormatter={(l) => bucketLabel(l, ctx.granularity, fmt, t)}
                      series={[
                        { key: 'succeeded', label: t('analytics.succeeded') },
                        { key: 'failed', label: t('common.failed') },
                      ]}
                    />
                  </SectionCard>
                  <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
                    <SectionCard title={t('analytics.runsByStatus')}>
                      <BreakdownList
                        label={t('analytics.runsByStatus')}
                        items={recordToRows(totals.byStatus).map((s) => ({
                          key: s.key,
                          label: s.key.replace(/_/g, ' '),
                          count: s.count,
                        }))}
                      />
                    </SectionCard>
                    <SectionCard title={t('common.byAgent')} flush>
                      <DataTable
                        caption={t('analytics.agentPerformanceByAgent')}
                        rows={d.byAgent}
                        rowKey={(r) => r.agentId}
                        columns={[
                          { header: t('common.agent'), render: (r) => r.name },
                          { header: t('common.runs'), align: 'right', render: (r) => r.executions },
                          {
                            header: t('analytics.success'),
                            align: 'right',
                            render: (r) => pct(r.successRate, fmt),
                          },
                          {
                            header: 'p50',
                            align: 'right',
                            render: (r) => formatDuration(r.durationMs.p50, fmt),
                          },
                          {
                            header: 'p95',
                            align: 'right',
                            render: (r) => formatDuration(r.durationMs.p95, fmt),
                          },
                          {
                            header: t('common.tokens'),
                            align: 'right',
                            render: (r) => fmt.compact(r.totalTokens),
                          },
                          {
                            header: t('common.cost'),
                            align: 'right',
                            render: (r) => formatUsd(r.costUsd, fmt),
                          },
                        ]}
                      />
                    </SectionCard>
                  </div>
                </>
              )}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
