'use client';

import { Bot } from 'lucide-react';
import { AreaChart, EmptyState, StatCard, formatCompact } from '@hilatech/ui';
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

export function AgentsTab({ ctx }: { ctx: ReportContext }) {
  const query = useAgentAnalytics(ctx.params);
  return (
    <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle="Agent analytics couldn’t be loaded"
      >
        {(d) => {
          const t = d.totals;
          const costNote = !d.pricingConfigured
            ? 'No model pricing is configured, so costs are not estimated. Token counts are exact.'
            : t.costCoverage.priced < t.costCoverage.total
              ? `Cost covers ${t.costCoverage.priced} of ${t.costCoverage.total} runs; runs on models without a configured price are left out, so the total is a lower bound.`
              : null;
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Runs"
                  value={t.executions}
                  hint={`${t.succeeded} succeeded · ${t.failed} failed`}
                />
                <StatCard
                  label="Success rate"
                  value={pct(t.successRate)}
                  hint={t.successRate == null ? 'No finished runs' : 'succeeded ÷ finished'}
                />
                <StatCard
                  label="Median duration"
                  value={formatDuration(t.durationMs.p50)}
                  hint={`p95 ${formatDuration(t.durationMs.p95)}`}
                />
                <StatCard
                  label="Tokens"
                  value={t.totalTokens}
                  hint={`${formatCompact(t.inputTokens)} in · ${formatCompact(t.outputTokens)} out`}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Estimated cost"
                  value={formatUsd(t.costUsd)}
                  hint={
                    t.costUsd == null
                      ? 'Not available'
                      : `${t.costCoverage.priced}/${t.costCoverage.total} runs priced`
                  }
                />
              </div>
              {costNote ? (
                <ReportNote
                  title={d.pricingConfigured ? 'Partial cost coverage' : 'Cost is not available'}
                  testId="agents-cost-note"
                >
                  {costNote}
                </ReportNote>
              ) : null}

              {t.executions === 0 ? (
                <EmptyState
                  icon={<Bot />}
                  title="No agent runs in this range"
                  description="Runs appear here once your agents execute. Widen the date range or run an agent."
                />
              ) : (
                <>
                  <SectionCard
                    title="Runs over time"
                    description="Successful and failed runs per period (UTC); failed includes timeouts."
                  >
                    <AreaChart
                      data={d.series.map((p) => ({ ...p }))}
                      xKey="bucket"
                      height={240}
                      labelFormatter={(l) => bucketLabel(l, ctx.granularity)}
                      series={[
                        { key: 'succeeded', label: 'Succeeded' },
                        { key: 'failed', label: 'Failed' },
                      ]}
                    />
                  </SectionCard>
                  <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
                    <SectionCard title="Runs by status">
                      <BreakdownList
                        label="Runs by status"
                        items={recordToRows(t.byStatus).map((s) => ({
                          key: s.key,
                          label: s.key.replace(/_/g, ' '),
                          count: s.count,
                        }))}
                      />
                    </SectionCard>
                    <SectionCard title="By agent" flush>
                      <DataTable
                        caption="Agent performance by agent"
                        rows={d.byAgent}
                        rowKey={(r) => r.agentId}
                        columns={[
                          { header: 'Agent', render: (r) => r.name },
                          { header: 'Runs', align: 'right', render: (r) => r.executions },
                          { header: 'Success', align: 'right', render: (r) => pct(r.successRate) },
                          {
                            header: 'p50',
                            align: 'right',
                            render: (r) => formatDuration(r.durationMs.p50),
                          },
                          {
                            header: 'p95',
                            align: 'right',
                            render: (r) => formatDuration(r.durationMs.p95),
                          },
                          {
                            header: 'Tokens',
                            align: 'right',
                            render: (r) => formatCompact(r.totalTokens),
                          },
                          { header: 'Cost', align: 'right', render: (r) => formatUsd(r.costUsd) },
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
