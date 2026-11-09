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

export function AutomationTab({ ctx }: { ctx: ReportContext }) {
  const query = useAutomationAnalytics(ctx.params);
  return (
    <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle="Automation analytics couldn’t be loaded"
      >
        {(d) => {
          const w = d.workflows;
          const h = d.webhooks;
          const none = w.runs === 0 && h.deliveries === 0;
          return (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Workflow runs" value={w.runs} />
                <StatCard
                  label="Workflow success rate"
                  value={pct(w.successRate)}
                  hint={
                    w.successRate == null
                      ? 'No finished runs'
                      : `median ${formatDuration(w.durationMs.p50)}`
                  }
                />
                <StatCard label="Webhook deliveries" value={h.deliveries} />
                <StatCard
                  label="Delivery success rate"
                  value={pct(h.successRate)}
                  hint={
                    h.avgAttempts == null
                      ? 'No finished deliveries'
                      : `${Math.round(h.avgAttempts * 10) / 10} attempts avg.`
                  }
                />
              </div>

              {none ? (
                <EmptyState
                  icon={<Workflow />}
                  title="No automation activity in this range"
                  description="Workflow runs and webhook deliveries show up here once automations fire. Widen the date range or run a workflow."
                />
              ) : (
                <>
                  <SectionCard
                    title="Workflow runs over time"
                    description="Successful and failed runs per period (UTC)."
                  >
                    <AreaChart
                      data={w.series.map((p) => ({ ...p }))}
                      xKey="bucket"
                      height={220}
                      labelFormatter={(l) => bucketLabel(l, ctx.granularity)}
                      series={[
                        { key: 'succeeded', label: 'Succeeded' },
                        { key: 'failed', label: 'Failed' },
                      ]}
                    />
                  </SectionCard>
                  <div className="grid gap-6 lg:grid-cols-2">
                    <SectionCard title="By workflow" flush>
                      <DataTable
                        caption="Runs by workflow"
                        rows={w.byWorkflow}
                        rowKey={(r) => r.workflowId}
                        emptyText="No workflow runs in this range."
                        columns={[
                          { header: 'Workflow', render: (r) => r.name },
                          { header: 'Runs', align: 'right', render: (r) => r.runs },
                          { header: 'Failed', align: 'right', render: (r) => r.failed },
                          { header: 'Success', align: 'right', render: (r) => pct(r.successRate) },
                        ]}
                      />
                    </SectionCard>
                    <SectionCard title="Top workflow failure reasons" flush>
                      <DataTable
                        caption="Workflow failure reasons"
                        rows={w.failureReasons}
                        rowKey={(r, i) => `${i}-${r.reason}`}
                        emptyText="No workflow failures in this range."
                        columns={[
                          {
                            header: 'Reason',
                            render: (r) => (
                              <span className="break-words whitespace-normal">{r.reason}</span>
                            ),
                          },
                          { header: 'Count', align: 'right', render: (r) => r.count },
                        ]}
                      />
                    </SectionCard>
                  </div>

                  <SectionCard
                    title="Webhook deliveries over time"
                    description="Delivered and failed per period (UTC); pending deliveries are not counted in the success rate."
                  >
                    <AreaChart
                      data={h.series.map((p) => ({ ...p }))}
                      xKey="bucket"
                      height={200}
                      labelFormatter={(l) => bucketLabel(l, ctx.granularity)}
                      series={[
                        { key: 'succeeded', label: 'Delivered' },
                        { key: 'failed', label: 'Failed' },
                      ]}
                    />
                  </SectionCard>
                  <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
                    <SectionCard title="Deliveries by status">
                      <BreakdownList
                        label="Deliveries by status"
                        items={recordToRows(h.byStatus).map((s) => ({
                          key: s.key,
                          label: s.key.replace(/_/g, ' '),
                          count: s.count,
                        }))}
                        emptyText="No webhook deliveries in this range."
                      />
                    </SectionCard>
                    <SectionCard title="By event" flush>
                      <DataTable
                        caption="Webhook deliveries by event"
                        rows={h.byEvent}
                        rowKey={(r) => r.event}
                        emptyText="No webhook deliveries in this range."
                        columns={[
                          { header: 'Event', render: (r) => r.event },
                          { header: 'Total', align: 'right', render: (r) => r.total },
                          { header: 'Delivered', align: 'right', render: (r) => r.delivered },
                          { header: 'Failed', align: 'right', render: (r) => r.failed },
                        ]}
                      />
                    </SectionCard>
                  </div>
                  {h.failureReasons.length > 0 ? (
                    <SectionCard title="Top webhook failure reasons" flush>
                      <DataTable
                        caption="Webhook failure reasons"
                        rows={h.failureReasons}
                        rowKey={(r, i) => `${i}-${r.reason}`}
                        columns={[
                          {
                            header: 'Reason',
                            render: (r) => (
                              <span className="break-words whitespace-normal">{r.reason}</span>
                            ),
                          },
                          { header: 'Count', align: 'right', render: (r) => r.count },
                        ]}
                      />
                    </SectionCard>
                  ) : null}
                  <InlineHint>Failure reasons are truncated to 200 characters.</InlineHint>
                </>
              )}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
