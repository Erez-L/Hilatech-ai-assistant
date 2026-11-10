'use client';

import { BarChart3 } from 'lucide-react';
import { AreaChart, EmptyState, StatCard } from '@hilatech/ui';
import { useBusinessAnalytics } from '@/hooks/analytics';
import { QueryState } from '@/components/common/query-state';
import { bucketLabel, hasActivity, pct, recordToRows } from '@/lib/analytics';
import {
  CONVERSATION_CHANNEL_LABELS,
  CONVERSATION_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
} from '@/lib/crm';
import {
  BreakdownList,
  DataTable,
  ExportButtons,
  InlineHint,
  ReportNote,
  ReportSkeleton,
  SectionCard,
  mergeSeries,
  type ReportContext,
} from './report-parts';
import { useT, useFormat } from '@/i18n/provider';
import { tm } from '@/i18n/msg';

export function BusinessTab({ ctx }: { ctx: ReportContext }) {
  const t = useT();
  const fmt = useFormat();
  const query = useBusinessAnalytics(ctx.params);
  return (
    <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle={t('analytics.businessAnalyticsCouldnTBe')}
      >
        {(d) => {
          const chartData = mergeSeries([
            { key: 'leads', points: d.leads.series },
            { key: 'conversations', points: d.conversations.series },
            { key: 'contacts', points: d.contacts.series },
          ]);
          const anyActivity =
            d.leads.created + d.conversations.created + d.contacts.created > 0 ||
            hasActivity(chartData, ['leads', 'conversations', 'contacts']);
          const status = recordToRows(
            d.leads.byStatus,
            Object.keys(LEAD_STATUS_LABELS) as (keyof typeof LEAD_STATUS_LABELS)[],
          );
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label={t('analytics.leadsCreated')} value={d.leads.created} />
                <StatCard label={t('analytics.contactsCreated')} value={d.contacts.created} />
                <StatCard
                  label={t('analytics.conversationsCreated')}
                  value={d.conversations.created}
                />
                <StatCard
                  label={t('analytics.leadConversion')}
                  value={pct(d.funnel.conversionRate, fmt)}
                  hint={
                    d.funnel.conversionRate == null
                      ? t('analytics.noLeadsCreatedInThis')
                      : t('analytics.wonCreated')
                  }
                />
              </div>

              <SectionCard
                title={t('analytics.activityOverTime')}
                description={t('analytics.newLeadsConversationsAndContacts')}
                actions={
                  <ExportButtons report="business" ctx={ctx} label={t('analytics.business')} />
                }
              >
                {anyActivity ? (
                  <AreaChart
                    data={chartData}
                    xKey="bucket"
                    height={260}
                    labelFormatter={(l) => bucketLabel(l, ctx.granularity, fmt, t)}
                    series={[
                      { key: 'leads', label: t('common.leads') },
                      { key: 'conversations', label: t('common.conversations') },
                      { key: 'contacts', label: t('common.contacts') },
                    ]}
                  />
                ) : (
                  <EmptyState
                    compact
                    icon={<BarChart3 />}
                    title={t('analytics.noActivityInThisRange')}
                    description={t('analytics.noLeadsConversationsOrContacts')}
                  />
                )}
              </SectionCard>

              <div className="grid gap-6 lg:grid-cols-2">
                <SectionCard
                  title={t('analytics.leadFunnel')}
                  description={t('analytics.howManyLeadsCreatedIn')}
                  flush
                >
                  <DataTable
                    caption={t('analytics.leadFunnel')}
                    rows={d.funnel.stages}
                    rowKey={(r) => r.status}
                    columns={[
                      { header: t('common.stage'), render: (r) => t(LEAD_STATUS_LABELS[r.status]) },
                      { header: t('analytics.reached'), align: 'right', render: (r) => r.reached },
                      {
                        header: t('analytics.fromPrevious'),
                        align: 'right',
                        render: (r) => pct(r.rateFromPrevious, fmt),
                      },
                      {
                        header: t('analytics.fromTop'),
                        align: 'right',
                        render: (r) => pct(r.rateFromTop, fmt),
                      },
                    ]}
                  />
                  <div className="flex flex-col gap-2 px-5 py-3 text-sm">
                    <p>
                      <span className="text-fg-muted">{t('analytics.lost')} </span>
                      <span className="font-medium tabular">{d.funnel.lost}</span>
                    </p>
                    <InlineHint>{t('analytics.thereIsNoStageHistory')}</InlineHint>
                  </div>
                </SectionCard>

                <SectionCard
                  title={t('analytics.leadsByStatus')}
                  description={t('analytics.currentStatusOfLeadsCreated')}
                >
                  <BreakdownList
                    label={t('analytics.leadsByStatus')}
                    items={status.map((s) => ({
                      key: s.key,
                      label: t(LEAD_STATUS_LABELS[s.key]),
                      count: s.count,
                    }))}
                    emptyText={t('analytics.noLeadsWereCreatedIn')}
                  />
                </SectionCard>

                <SectionCard title={t('analytics.leadsBySource')}>
                  <BreakdownList
                    label={t('analytics.leadsBySource')}
                    items={recordToRows(d.leads.bySource).map((s) => ({
                      key: s.key,
                      label: tm(t, LEAD_SOURCE_LABELS[s.key] ?? s.key),
                      count: s.count,
                    }))}
                    emptyText={t('analytics.noLeadsWereCreatedIn')}
                  />
                </SectionCard>

                <SectionCard title={t('analytics.conversationsByChannel')}>
                  <BreakdownList
                    label={t('analytics.conversationsByChannel')}
                    items={recordToRows(d.conversations.byChannel).map((s) => ({
                      key: s.key,
                      label: tm(t, CONVERSATION_CHANNEL_LABELS[s.key] ?? s.key),
                      count: s.count,
                    }))}
                    emptyText={t('analytics.noConversationsWereCreatedIn')}
                  />
                </SectionCard>

                <SectionCard title={t('analytics.conversationsByStatus')}>
                  <BreakdownList
                    label={t('analytics.conversationsByStatus')}
                    items={recordToRows(d.conversations.byStatus).map((s) => ({
                      key: s.key,
                      label: tm(t, CONVERSATION_STATUS_LABELS[s.key] ?? s.key),
                      count: s.count,
                    }))}
                    emptyText={t('analytics.noConversationsWereCreatedIn')}
                  />
                </SectionCard>
              </div>

              {d.tasks.modelled ? (
                <ReportNote title={t('analytics.tasks')} testId="tasks-modelled">
                  {t('analytics.tasksSummary', {
                    open: d.tasks.open,
                    overdue: d.tasks.overdue,
                    dueToday: d.tasks.dueToday,
                  })}
                </ReportNote>
              ) : (
                <ReportNote title={t('analytics.tasksAreNotTracked')} testId="tasks-not-modelled">
                  {d.tasks.reason}
                </ReportNote>
              )}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
