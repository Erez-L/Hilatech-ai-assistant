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

export function BusinessTab({ ctx }: { ctx: ReportContext }) {
  const query = useBusinessAnalytics(ctx.params);
  return (
    <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle="Business analytics couldn’t be loaded"
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
                <StatCard label="Leads created" value={d.leads.created} />
                <StatCard label="Contacts created" value={d.contacts.created} />
                <StatCard label="Conversations created" value={d.conversations.created} />
                <StatCard
                  label="Lead conversion"
                  value={pct(d.funnel.conversionRate)}
                  hint={
                    d.funnel.conversionRate == null
                      ? 'No leads created in this range'
                      : 'won ÷ created'
                  }
                />
              </div>

              <SectionCard
                title="Activity over time"
                description="New leads, conversations and contacts per period (UTC)."
                actions={<ExportButtons report="business" ctx={ctx} label="business" />}
              >
                {anyActivity ? (
                  <AreaChart
                    data={chartData}
                    xKey="bucket"
                    height={260}
                    labelFormatter={(l) => bucketLabel(l, ctx.granularity)}
                    series={[
                      { key: 'leads', label: 'Leads' },
                      { key: 'conversations', label: 'Conversations' },
                      { key: 'contacts', label: 'Contacts' },
                    ]}
                  />
                ) : (
                  <EmptyState
                    compact
                    icon={<BarChart3 />}
                    title="No activity in this range"
                    description="No leads, conversations or contacts were created in the selected dates. Widen the range to see more."
                  />
                )}
              </SectionCard>

              <div className="grid gap-6 lg:grid-cols-2">
                <SectionCard
                  title="Lead funnel"
                  description="How many leads created in this range reached each stage."
                  flush
                >
                  <DataTable
                    caption="Lead funnel"
                    rows={d.funnel.stages}
                    rowKey={(r) => r.status}
                    columns={[
                      { header: 'Stage', render: (r) => LEAD_STATUS_LABELS[r.status] },
                      { header: 'Reached', align: 'right', render: (r) => r.reached },
                      {
                        header: 'From previous',
                        align: 'right',
                        render: (r) => pct(r.rateFromPrevious),
                      },
                      { header: 'From top', align: 'right', render: (r) => pct(r.rateFromTop) },
                    ]}
                  />
                  <div className="flex flex-col gap-2 px-5 py-3 text-sm">
                    <p>
                      <span className="text-fg-muted">Lost: </span>
                      <span className="font-medium tabular">{d.funnel.lost}</span>
                    </p>
                    <InlineHint>
                      There is no stage history, so a lead counts as having “reached” a stage when
                      its current status is that stage or a later one.
                    </InlineHint>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Leads by status"
                  description="Current status of leads created in this range."
                >
                  <BreakdownList
                    label="Leads by status"
                    items={status.map((s) => ({
                      key: s.key,
                      label: LEAD_STATUS_LABELS[s.key],
                      count: s.count,
                    }))}
                    emptyText="No leads were created in this range."
                  />
                </SectionCard>

                <SectionCard title="Leads by source">
                  <BreakdownList
                    label="Leads by source"
                    items={recordToRows(d.leads.bySource).map((s) => ({
                      key: s.key,
                      label: LEAD_SOURCE_LABELS[s.key] ?? s.key,
                      count: s.count,
                    }))}
                    emptyText="No leads were created in this range."
                  />
                </SectionCard>

                <SectionCard title="Conversations by channel">
                  <BreakdownList
                    label="Conversations by channel"
                    items={recordToRows(d.conversations.byChannel).map((s) => ({
                      key: s.key,
                      label: CONVERSATION_CHANNEL_LABELS[s.key] ?? s.key,
                      count: s.count,
                    }))}
                    emptyText="No conversations were created in this range."
                  />
                </SectionCard>

                <SectionCard title="Conversations by status">
                  <BreakdownList
                    label="Conversations by status"
                    items={recordToRows(d.conversations.byStatus).map((s) => ({
                      key: s.key,
                      label: CONVERSATION_STATUS_LABELS[s.key] ?? s.key,
                      count: s.count,
                    }))}
                    emptyText="No conversations were created in this range."
                  />
                </SectionCard>
              </div>

              <ReportNote title="Tasks are not tracked" testId="tasks-not-modelled">
                {d.tasks.reason}
              </ReportNote>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
