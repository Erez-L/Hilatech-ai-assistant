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
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle={t('analytics.salesAnalyticsCouldnTBe')}
      >
        {(d) => {
          const closedTotal = d.closedInRange.reduce((n, c) => n + c.wonCount + c.lostCount, 0);
          const wonTotal = d.closedInRange.reduce((n, c) => n + c.wonCount, 0);
          const onDeals = d.basis === 'deals';
                    const empty = onDeals
            ? (d.stages?.length ?? 0) === 0 && d.closedInRange.length === 0
            : d.pipeline.length === 0 && d.closedInRange.length === 0;
          return (
            <>
              {onDeals ? null : (
                <ReportNote title={t('analytics.salesAreDerivedFromLeads')} testId="deals-not-modelled">
                  {t('analytics.thereIsNoDealsOr')}
                </ReportNote>
              )}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label={t('analytics.winRate')}
                  value={pct(d.winRate, fmt)}
                  hint={
                    d.winRate == null
                      ? onDeals ? t('analytics.noDealsClosedInThis') : t('analytics.noLeadsClosedInThis')
                      : t('analytics.wonWonLost')
                  }
                />
                <StatCard label={onDeals ? t('analytics.dealsWon') : t('analytics.leadsWon')} value={wonTotal} />
                <StatCard label={onDeals ? t('analytics.dealsClosed') : t('analytics.leadsClosed')} value={closedTotal} />
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
                    d.avgSalesCycleDays == null ? onDeals ? t('analytics.noWonDealsToMeasure') : t('analytics.noWonLeadsToMeasure') : undefined
                  }
                />
              </div>

              {empty ? (
                <EmptyState
                  icon={<Target />}
                  title={onDeals ? t('analytics.noDealsInRange') : t('analytics.noLeadsWithAValue')}
                  description={onDeals ? t('analytics.noDealsInRangeHint') : t('analytics.addAValueToYour')}
                />
              ) : (
                <>
                  {onDeals ? (
                    <SectionCard
                      title={t('analytics.openPipelineByStage')}
                      description={t('analytics.openPipelineByStageHint')}
                      flush
                    >
                      <div data-testid="sales-stages">
                        <DataTable
                          caption={t('analytics.openPipelineByStage')}
                          rows={d.stages ?? []}
                          rowKey={(r) => `${r.stageId}-${r.currency}`}
                          emptyText={t('analytics.noOpenDeals')}
                          columns={[
                            { header: t('deals.pipeline'), render: (r) => r.pipelineName },
                            { header: t('common.stage'), render: (r) => r.stageName },
                            { header: t('common.currency'), render: (r) => r.currency },
                            { header: t('deals.deals'), align: 'right', render: (r) => r.count },
                            {
                              header: t('common.value'),
                              align: 'right',
                              render: (r) => fmt.currency(r.value, r.currency),
                            },
                            {
                              header: t('deals.weighted'),
                              align: 'right',
                              render: (r) => fmt.currency(r.weightedValue, r.currency),
                            },
                          ]}
                        />
                      </div>
                    </SectionCard>
                  ) : (
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
                  )}

                  <SectionCard
                    title={t('analytics.closedInRange')}
                    description={onDeals ? t('analytics.wonAndLostDealsBy') : t('analytics.wonAndLostLeadsBy')}
                    flush
                  >
                    <DataTable
                      caption={onDeals ? t('analytics.closedDealsByCurrency') : t('analytics.closedLeadsByCurrency')}
                      rows={d.closedInRange}
                      rowKey={(r) => r.currency}
                      emptyText={onDeals ? t('analytics.noDealsWereClosedIn') : t('analytics.noLeadsWereClosedIn')}
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

                  <div className={onDeals ? 'grid gap-6' : 'grid gap-6 lg:grid-cols-2'}>
                    {onDeals ? null : (
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
                    )}
                    <SectionCard title={onDeals ? t('analytics.dealsWonOverTime') : t('analytics.leadsWonOverTime')}>
                      {hasActivity(d.wonSeries, ['count']) ? (
                        <BarChart
                          data={d.wonSeries.map((p) => ({
                            bucket: bucketLabel(p.bucket, ctx.granularity, fmt, t),
                            won: p.count,
                          }))}
                          xKey="bucket"
                          series={[{ key: 'won', label: onDeals ? t('analytics.dealsWon') : t('analytics.leadsWon') }]}
                          height={220}
                        />
                      ) : (
                        <p className="text-sm text-fg-muted">{onDeals ? t('analytics.noDealsWereWonIn') : t('analytics.noLeadsWereWonIn')}</p>
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
