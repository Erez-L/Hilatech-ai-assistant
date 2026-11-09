'use client';

import { Target } from 'lucide-react';
import { BarChart, EmptyState, StatCard, formatCurrency } from '@hilatech/ui';
import { useSalesAnalytics } from '@/hooks/analytics';
import { QueryState } from '@/components/common/query-state';
import { bucketLabel, hasActivity, pct } from '@/lib/analytics';
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from '@/lib/crm';
import {
  DataTable,
  ReportNote,
  ReportSkeleton,
  SectionCard,
  type ReportContext,
} from './report-parts';

export function SalesTab({ ctx }: { ctx: ReportContext }) {
  const query = useSalesAnalytics(ctx.params);
  return (
    <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
      <ReportNote title="Sales are derived from leads" testId="deals-not-modelled">
        There is no deals or opportunities model yet, so these figures come from leads that carry a
        value. A won or lost lead is dated by its conversion date, or its last update when it has
        none. Amounts are never added up across currencies.
      </ReportNote>
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle="Sales analytics couldn’t be loaded"
      >
        {(d) => {
          const closedTotal = d.closedInRange.reduce((n, c) => n + c.wonCount + c.lostCount, 0);
          const wonTotal = d.closedInRange.reduce((n, c) => n + c.wonCount, 0);
          const empty = d.pipeline.length === 0 && d.closedInRange.length === 0;
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Win rate"
                  value={pct(d.winRate)}
                  hint={d.winRate == null ? 'No leads closed in this range' : 'won ÷ (won + lost)'}
                />
                <StatCard label="Leads won" value={wonTotal} />
                <StatCard label="Leads closed" value={closedTotal} />
                <StatCard
                  label="Avg. sales cycle"
                  value={
                    d.avgSalesCycleDays == null
                      ? '—'
                      : `${Math.round(d.avgSalesCycleDays * 10) / 10} days`
                  }
                  hint={d.avgSalesCycleDays == null ? 'No won leads to measure' : undefined}
                />
              </div>

              {empty ? (
                <EmptyState
                  icon={<Target />}
                  title="No leads with a value yet"
                  description="Add a value to your leads and mark them won or lost to see the pipeline and win rate here."
                />
              ) : (
                <>
                  <SectionCard
                    title="Open pipeline"
                    description="Leads still in progress, by stage and currency."
                    flush
                  >
                    <DataTable
                      caption="Open pipeline"
                      rows={d.pipeline}
                      rowKey={(r) => `${r.status}-${r.currency}`}
                      emptyText="No open leads carry a value."
                      columns={[
                        { header: 'Stage', render: (r) => LEAD_STATUS_LABELS[r.status] },
                        { header: 'Currency', render: (r) => r.currency },
                        { header: 'Leads', align: 'right', render: (r) => r.count },
                        {
                          header: 'Value',
                          align: 'right',
                          render: (r) => formatCurrency(r.value, r.currency),
                        },
                      ]}
                    />
                  </SectionCard>

                  <SectionCard
                    title="Closed in range"
                    description="Won and lost leads by currency."
                    flush
                  >
                    <DataTable
                      caption="Closed leads by currency"
                      rows={d.closedInRange}
                      rowKey={(r) => r.currency}
                      emptyText="No leads were closed in this range."
                      columns={[
                        { header: 'Currency', render: (r) => r.currency },
                        { header: 'Won', align: 'right', render: (r) => r.wonCount },
                        {
                          header: 'Won value',
                          align: 'right',
                          render: (r) => formatCurrency(r.wonValue, r.currency),
                        },
                        { header: 'Lost', align: 'right', render: (r) => r.lostCount },
                        {
                          header: 'Lost value',
                          align: 'right',
                          render: (r) => formatCurrency(r.lostValue, r.currency),
                        },
                        {
                          header: 'Avg. won value',
                          align: 'right',
                          render: (r) =>
                            r.avgWonValue == null ? '—' : formatCurrency(r.avgWonValue, r.currency),
                        },
                      ]}
                    />
                  </SectionCard>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <SectionCard title="Win rate by source" flush>
                      <DataTable
                        caption="Win rate by source"
                        rows={d.bySource}
                        rowKey={(r) => r.source}
                        emptyText="No leads were closed in this range."
                        columns={[
                          {
                            header: 'Source',
                            render: (r) => LEAD_SOURCE_LABELS[r.source] ?? r.source,
                          },
                          { header: 'Won', align: 'right', render: (r) => r.won },
                          { header: 'Lost', align: 'right', render: (r) => r.lost },
                          { header: 'Win rate', align: 'right', render: (r) => pct(r.winRate) },
                        ]}
                      />
                    </SectionCard>
                    <SectionCard title="Leads won over time">
                      {hasActivity(d.wonSeries, ['count']) ? (
                        <BarChart
                          data={d.wonSeries.map((p) => ({
                            bucket: bucketLabel(p.bucket, ctx.granularity),
                            won: p.count,
                          }))}
                          xKey="bucket"
                          series={[{ key: 'won', label: 'Leads won' }]}
                          height={220}
                        />
                      ) : (
                        <p className="text-sm text-fg-muted">No leads were won in this range.</p>
                      )}
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
