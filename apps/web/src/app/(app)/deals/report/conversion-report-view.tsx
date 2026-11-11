'use client';

import * as React from 'react';
import { Funnel } from 'lucide-react';
import { Permission, type DealConversionReport } from '@hilatech/contracts';
import { EmptyState, Input, Label, NativeSelect, PageHeader, StatCard } from '@hilatech/ui';
import { useDealConversion, usePipelines } from '@/hooks/sales';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { DealsTabs } from '@/components/deals/deals-tabs';
import { pct } from '@/lib/analytics';
import { STAGE_KIND_LABELS } from '@/lib/deals';
import { DataTable, ReportSkeleton, SectionCard } from '../../analytics/report-parts';
import { useFormat, useT } from '@/i18n/provider';

const dayInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Funnel over the open stages: one bar per stage, sized by the deals that reached it. */
function ConversionFunnel({ stages }: { stages: DealConversionReport['stages'] }) {
  const t = useT();
  const fmt = useFormat();
  const top = Math.max(1, ...stages.map((s) => s.reached));
  return (
    <ol
      className="flex flex-col gap-3"
      aria-label={t('deals.conversionFunnel')}
      data-testid="conversion-funnel"
    >
      {stages.map((s) => (
        <li key={s.stageId} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium" dir="auto">
              {s.name}
            </span>
            <span className="tabular text-fg-muted">
              <span className="font-semibold text-fg">{s.reached}</span>
              <span className="ms-2 text-xs">{pct(s.rateFromTop, fmt)}</span>
            </span>
          </div>
          <div className="h-6 w-full overflow-hidden rounded-md bg-surface-muted" aria-hidden>
            <div
              className="h-full rounded-md"
              style={{
                width: `${Math.max(1.5, (s.reached / top) * 100)}%`,
                background: 'var(--color-chart-1)',
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The API groups lost deals without a reason under this literal. */
const NO_REASON = '(no reason)';

export function ConversionReportView() {
  const t = useT();
  const fmt = useFormat();
  const pipelines = usePipelines();
  const [pipelineId, setPipelineId] = React.useState('');
  const [from, setFrom] = React.useState(() => dayInput(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = React.useState(() => dayInput(new Date()));
  const activeId =
    pipelines.data?.find((p) => p.id === pipelineId)?.id ??
    pipelines.data?.find((p) => p.isDefault)?.id ??
    pipelines.data?.[0]?.id;

  const params = React.useMemo(
    () => ({
      pipelineId: activeId,
      ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
      // `to` is exclusive on the API; the date picked here is inclusive.
      ...(to
        ? { to: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString() }
        : {}),
    }),
    [activeId, from, to],
  );
  const report = useDealConversion(params, { enabled: !!activeId });

  return (
    <PermissionGate anyOf={[Permission.DEALS_READ]}>
      <PermissionGate anyOf={[Permission.ANALYTICS_READ]}>
        <div className="flex flex-col gap-6" aria-busy={report.isFetching}>
          <PageHeader title={t('deals.deals')} description={t('deals.reportDescription')}>
            <DealsTabs />
          </PageHeader>
          <div className="grid gap-4 sm:grid-cols-3 lg:max-w-3xl">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-pipeline">{t('deals.pipeline')}</Label>
              <NativeSelect
                id="report-pipeline"
                value={activeId ?? ''}
                onChange={(e) => setPipelineId(e.target.value)}
              >
                {(pipelines.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-from">{t('deals.createdFrom')}</Label>
              <Input
                id="report-from"
                type="date"
                dir="ltr"
                className="text-start"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="report-to">{t('deals.createdTo')}</Label>
              <Input
                id="report-to"
                type="date"
                dir="ltr"
                className="text-start"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          <QueryState
            query={report}
            loading={<ReportSkeleton />}
            errorTitle={t('deals.reportCouldntBeLoaded')}
          >
            {(d) => (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <StatCard label={t('deals.dealsCreated')} value={d.deals.created} />
                  <StatCard label={t('deals.status.open')} value={d.deals.open} />
                  <StatCard label={t('deals.status.won')} value={d.deals.won} />
                  <StatCard label={t('deals.status.lost')} value={d.deals.lost} />
                  <StatCard
                    label={t('deals.winRate')}
                    value={pct(d.winRate, fmt)}
                    hint={
                      d.avgCycleDays == null
                        ? t('deals.noWonDealsToMeasure')
                        : t('deals.avgCycleDays', { count: Math.round(d.avgCycleDays * 10) / 10 })
                    }
                  />
                </div>

                <SectionCard
                  title={t('deals.conversionFunnel')}
                  description={t('deals.conversionFunnelDescription')}
                >
                  {d.stages.length === 0 || d.deals.created === 0 ? (
                    <EmptyState
                      compact
                      icon={<Funnel />}
                      title={t('deals.noDealsInThisRange')}
                      description={t('deals.noDealsInThisRangeHint')}
                    />
                  ) : (
                    <ConversionFunnel stages={d.stages} />
                  )}
                </SectionCard>

                <SectionCard title={t('deals.stageConversion')} flush>
                  <DataTable
                    caption={t('deals.stageConversion')}
                    rows={d.stages}
                    rowKey={(r) => r.stageId}
                    columns={[
                      {
                        header: t('common.stage'),
                        render: (r) => <span dir="auto">{r.name}</span>,
                      },
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
                </SectionCard>

                <div className="grid gap-6 lg:grid-cols-2">
                  <SectionCard
                    title={t('deals.valueByStage')}
                    description={t('deals.valueByStageDescription')}
                    flush
                  >
                    <DataTable
                      caption={t('deals.valueByStage')}
                      rows={d.valueByStage}
                      rowKey={(r) => `${r.stageId}-${r.currency}`}
                      columns={[
                        {
                          header: t('common.stage'),
                          render: (r) => <span dir="auto">{r.name}</span>,
                        },
                        { header: t('common.currency'), render: (r) => r.currency },
                        { header: t('deals.deals'), align: 'right', render: (r) => r.count },
                        {
                          header: t('common.value'),
                          align: 'right',
                          render: (r) => fmt.currency(r.value, r.currency),
                        },
                        {
                          header: t('deals.weightedValue'),
                          align: 'right',
                          render: (r) =>
                            r.kind === 'open'
                              ? fmt.currency(r.weightedValue, r.currency)
                              : t(STAGE_KIND_LABELS[r.kind]),
                        },
                      ]}
                    />
                  </SectionCard>
                  <div className="flex flex-col gap-6">
                    <SectionCard title={t('deals.wonValue')} flush>
                      <DataTable
                        caption={t('deals.wonValue')}
                        rows={d.wonValue}
                        rowKey={(r) => r.currency}
                        emptyText={t('deals.noWonDeals')}
                        columns={[
                          { header: t('common.currency'), render: (r) => r.currency },
                          { header: t('deals.deals'), align: 'right', render: (r) => r.count },
                          {
                            header: t('common.value'),
                            align: 'right',
                            render: (r) => fmt.currency(r.value, r.currency),
                          },
                        ]}
                      />
                    </SectionCard>
                    <SectionCard title={t('deals.lostReasons')} flush>
                      <DataTable
                        caption={t('deals.lostReasons')}
                        rows={d.lostReasons}
                        rowKey={(r) => r.reason}
                        emptyText={t('deals.noLostDeals')}
                        columns={[
                          {
                            header: t('common.reason'),
                            render: (r) => (
                              <span dir="auto">
                                {r.reason === NO_REASON ? t('deals.noReason') : r.reason}
                              </span>
                            ),
                          },
                          { header: t('deals.deals'), align: 'right', render: (r) => r.count },
                        ]}
                      />
                    </SectionCard>
                  </div>
                </div>
              </>
            )}
          </QueryState>
        </div>
      </PermissionGate>
    </PermissionGate>
  );
}
