'use client';

import { Workflow } from 'lucide-react';
import { AreaChart, EmptyState, StatCard } from '@hilatech/ui';
import { useAutomationAnalytics } from '@/hooks/analytics';
import { QueryState } from '@/components/common/query-state';
import { bucketLabel, formatDuration, pct, recordToRows } from '@/lib/analytics';
import {
  BreakdownList,
  DataTable,
  InlineHint,
  ReportSkeleton,
  SectionCard,
  type ReportContext,
} from './report-parts';
import { useT, useFormat } from '@/i18n/provider';

export function AutomationTab({ ctx }: { ctx: ReportContext }) {
  const t = useT();
  const fmt = useFormat();
  const query = useAutomationAnalytics(ctx.params);
  return (
    <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle={t('analytics.automationAnalyticsCouldnTBe')}
      >
        {(d) => {
          const w = d.workflows;
          const h = d.webhooks;
          const none = w.runs === 0 && h.deliveries === 0;
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label={t('analytics.workflowRuns')} value={w.runs} />
                <StatCard
                  label={t('analytics.workflowSuccessRate')}
                  value={pct(w.successRate, fmt)}
                  hint={
                    w.successRate == null
                      ? t('analytics.noFinishedRuns')
                      : t('analytics.median', {
                          formatDuration: formatDuration(w.durationMs.p50, fmt),
                        })
                  }
                />
                <StatCard label={t('analytics.webhookDeliveries')} value={h.deliveries} />
                <StatCard
                  label={t('analytics.deliverySuccessRate')}
                  value={pct(h.successRate, fmt)}
                  hint={
                    h.avgAttempts == null
                      ? t('analytics.noFinishedDeliveries')
                      : t('analytics.attemptsAvg', { value: Math.round(h.avgAttempts * 10) / 10 })
                  }
                />
              </div>

              {none ? (
                <EmptyState
                  icon={<Workflow />}
                  title={t('analytics.noAutomationActivityInThis')}
                  description={t('analytics.workflowRunsAndWebhookDeliveries')}
                />
              ) : (
                <>
                  <SectionCard
                    title={t('analytics.workflowRunsOverTime')}
                    description={t('analytics.successfulAndFailedRunsPer2')}
                  >
                    <AreaChart
                      data={w.series.map((p) => ({ ...p }))}
                      xKey="bucket"
                      height={220}
                      labelFormatter={(l) => bucketLabel(l, ctx.granularity, fmt, t)}
                      series={[
                        { key: 'succeeded', label: t('analytics.succeeded') },
                        { key: 'failed', label: t('common.failed') },
                      ]}
                    />
                  </SectionCard>
                  <div className="grid gap-6 lg:grid-cols-2">
                    <SectionCard title={t('analytics.byWorkflow')} flush>
                      <DataTable
                        caption={t('analytics.runsByWorkflow')}
                        rows={w.byWorkflow}
                        rowKey={(r) => r.workflowId}
                        emptyText={t('analytics.noWorkflowRunsInThis')}
                        columns={[
                          { header: t('common.workflow'), render: (r) => r.name },
                          { header: t('common.runs'), align: 'right', render: (r) => r.runs },
                          { header: t('common.failed'), align: 'right', render: (r) => r.failed },
                          {
                            header: t('analytics.success'),
                            align: 'right',
                            render: (r) => pct(r.successRate, fmt),
                          },
                        ]}
                      />
                    </SectionCard>
                    <SectionCard title={t('analytics.topWorkflowFailureReasons')} flush>
                      <DataTable
                        caption={t('analytics.workflowFailureReasons')}
                        rows={w.failureReasons}
                        rowKey={(r, i) => `${i}-${r.reason}`}
                        emptyText={t('analytics.noWorkflowFailuresInThis')}
                        columns={[
                          {
                            header: t('common.reason'),
                            render: (r) => (
                              <span className="break-words whitespace-normal">{r.reason}</span>
                            ),
                          },
                          { header: t('analytics.count'), align: 'right', render: (r) => r.count },
                        ]}
                      />
                    </SectionCard>
                  </div>

                  <SectionCard
                    title={t('analytics.webhookDeliveriesOverTime')}
                    description={t('analytics.deliveredAndFailedPerPeriod')}
                  >
                    <AreaChart
                      data={h.series.map((p) => ({ ...p }))}
                      xKey="bucket"
                      height={200}
                      labelFormatter={(l) => bucketLabel(l, ctx.granularity, fmt, t)}
                      series={[
                        { key: 'succeeded', label: t('common.delivered') },
                        { key: 'failed', label: t('common.failed') },
                      ]}
                    />
                  </SectionCard>
                  <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
                    <SectionCard title={t('analytics.deliveriesByStatus')}>
                      <BreakdownList
                        label={t('analytics.deliveriesByStatus')}
                        items={recordToRows(h.byStatus).map((s) => ({
                          key: s.key,
                          label: s.key.replace(/_/g, ' '),
                          count: s.count,
                        }))}
                        emptyText={t('analytics.noWebhookDeliveriesInThis')}
                      />
                    </SectionCard>
                    <SectionCard title={t('analytics.byEvent')} flush>
                      <DataTable
                        caption={t('analytics.webhookDeliveriesByEvent')}
                        rows={h.byEvent}
                        rowKey={(r) => r.event}
                        emptyText={t('analytics.noWebhookDeliveriesInThis')}
                        columns={[
                          { header: t('common.event'), render: (r) => r.event },
                          { header: t('analytics.total'), align: 'right', render: (r) => r.total },
                          {
                            header: t('common.delivered'),
                            align: 'right',
                            render: (r) => r.delivered,
                          },
                          { header: t('common.failed'), align: 'right', render: (r) => r.failed },
                        ]}
                      />
                    </SectionCard>
                  </div>
                  {h.failureReasons.length > 0 ? (
                    <SectionCard title={t('analytics.topWebhookFailureReasons')} flush>
                      <DataTable
                        caption={t('analytics.webhookFailureReasons')}
                        rows={h.failureReasons}
                        rowKey={(r, i) => `${i}-${r.reason}`}
                        columns={[
                          {
                            header: t('common.reason'),
                            render: (r) => (
                              <span className="break-words whitespace-normal">{r.reason}</span>
                            ),
                          },
                          { header: t('analytics.count'), align: 'right', render: (r) => r.count },
                        ]}
                      />
                    </SectionCard>
                  ) : null}
                  <InlineHint>{t('analytics.failureReasonsAreTruncatedTo')}</InlineHint>
                </>
              )}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
