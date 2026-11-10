'use client';

import { Target } from 'lucide-react';
import { BarChart, EmptyState, StatCard } from '@hilatech/ui';
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
import { useT, useFormat } from '@/i18n/provider';

export function SalesTab({ ctx }: { ctx: ReportContext }) {
  const fmt = useFormat();
  const t = useT();
  const query = useSalesAnalytics(ctx.params);
  return (
    <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
      <ReportNote title={t('analytics.salesAreDerivedFromLeads')} testId="deals-not-modelled">
        {t('analytics.thereIsNoDealsOr')}
      </ReportNote>
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle={t('analytics.salesAnalyticsCouldnTBe')}
      >
        {(d) => {
          const closedTotal = d.closedInRange.reduce((n, c) => n + c.wonCount + c.lostCount, 0);
          const wonTotal = d.closedInRange.reduce((n, c) => n + c.wonCount, 0);
          const empty = d.pipeline.length === 0 && d.closedInRange.length === 0;
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label={t('analytics.winRate')}
                  value={pct(d.winRate, fmt)}
                  hint={
                    d.winRate == null
                      ? t('analytics.noLeadsClosedInThis')
                      : t('analytics.wonWonLost')
                  }
                />
                <StatCard label={t('analytics.leadsWon')} value={wonTotal} />
                <StatCard label={t('analytics.leadsClosed')} value={closedTotal} />
                <StatCard
                  label={t('analytics.avgSalesCycle')}
                  value={
                    d.avgSalesCycleDays == null
                      ? '—'
                      : t('analytics.daysValue', {
                          count: Math.round(d.avgSalesCycleDays * 10) / 10,
                        })
                  }
                  hint={
                    d.avgSalesCycleDays == null ? t('analytics.noWonLeadsToMeasure') : undefined
                  }
                />
              </div>

              {empty ? (
                <EmptyState
                  icon={<Target />}
                  title={t('analytics.noLeadsWithAValue')}
                  description={t('analytics.addAValueToYour')}
                />
              ) : (
                <>
                  <SectionCard
                    title={t('analytics.openPipeline')}
                    description={t('analytics.leadsStillInProgressBy')}
                    flush
                  >
                    <DataTable
                      caption={t('analytics.openPipeline')}
                      rows={d.pipeline}
                      rowKey={(r) => `${r.status}-${r.currency}`}
                      emptyText={t('analytics.noOpenLeadsCarryA')}
                      columns={[
                        {
                          header: t('common.stage'),
                          render: (r) => t(LEAD_STATUS_LABELS[r.status]),
                        },
                        { header: t('common.currency'), render: (r) => r.currency },
                        { header: t('common.leads'), align: 'right', render: (r) => r.count },
                        {
                          header: t('common.value'),
                          align: 'right',
                          render: (r) => fmt.currency(r.value, r.currency),
                        },
                      ]}
                    />
                  </SectionCard>

                  <SectionCard
                    title={t('analytics.closedInRange')}
                    description={t('analytics.wonAndLostLeadsBy')}
                    flush
                  >
                    <DataTable
                      caption={t('analytics.closedLeadsByCurrency')}
                      rows={d.closedInRange}
                      rowKey={(r) => r.currency}
                      emptyText={t('analytics.noLeadsWereClosedIn')}
                      columns={[
                        { header: t('common.currency'), render: (r) => r.currency },
                        { header: t('common.won'), align: 'right', render: (r) => r.wonCount },
                        {
                          header: t('analytics.wonValue'),
                          align: 'right',
                          render: (r) => fmt.currency(r.wonValue, r.currency),
                        },
                        { header: t('common.lost'), align: 'right', render: (r) => r.lostCount },
                        {
                          header: t('analytics.lostValue'),
                          align: 'right',
                          render: (r) => fmt.currency(r.lostValue, r.currency),
                        },
                        {
                          header: t('analytics.avgWonValue'),
                          align: 'right',
                          render: (r) =>
                            r.avgWonValue == null ? '—' : fmt.currency(r.avgWonValue, r.currency),
                        },
                      ]}
                    />
                  </SectionCard>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <SectionCard title={t('analytics.winRateBySource')} flush>
                      <DataTable
                        caption={t('analytics.winRateBySource')}
                        rows={d.bySource}
                        rowKey={(r) => r.source}
                        emptyText={t('analytics.noLeadsWereClosedIn')}
                        columns={[
                          {
                            header: t('common.source'),
                            render: (r) => t(LEAD_SOURCE_LABELS[r.source] ?? r.source),
                          },
                          { header: t('common.won'), align: 'right', render: (r) => r.won },
                          { header: t('common.lost'), align: 'right', render: (r) => r.lost },
                          {
                            header: t('analytics.winRate'),
                            align: 'right',
                            render: (r) => pct(r.winRate, fmt),
                          },
                        ]}
                      />
                    </SectionCard>
                    <SectionCard title={t('analytics.leadsWonOverTime')}>
                      {hasActivity(d.wonSeries, ['count']) ? (
                        <BarChart
                          data={d.wonSeries.map((p) => ({
                            bucket: bucketLabel(p.bucket, ctx.granularity, fmt, t),
                            won: p.count,
                          }))}
                          xKey="bucket"
                          series={[{ key: 'won', label: t('analytics.leadsWon') }]}
                          height={220}
                        />
                      ) : (
                        <p className="text-sm text-fg-muted">{t('analytics.noLeadsWereWonIn')}</p>
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
