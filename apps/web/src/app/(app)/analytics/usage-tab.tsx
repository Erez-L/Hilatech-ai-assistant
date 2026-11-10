'use client';

import Link from 'next/link';
import { Cpu } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import { AreaChart, Badge, Button, EmptyState, Meter, StatCard } from '@hilatech/ui';
import { useUsageAnalytics } from '@/hooks/analytics';
import { useCan } from '@/hooks/use-can';
import { QueryState } from '@/components/common/query-state';
import { bucketLabel, formatUsd, pct } from '@/lib/analytics';
import {
  DataTable,
  ExportButtons,
  ReportNote,
  ReportSkeleton,
  SectionCard,
  type ReportContext,
} from './report-parts';
import { useT, useFormat } from '@/i18n/provider';

export function UsageTab({ ctx }: { ctx: ReportContext }) {
  const fmt = useFormat();
  const t = useT();
  const query = useUsageAnalytics(ctx.params);
  const canBilling = useCan(Permission.ORG_BILLING_MANAGE);
  return (
    <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle={t('analytics.usageAnalyticsCouldnTBe')}
      >
        {(d) => {
          const totals = d.totals;
          const cp = d.currentPeriod;
          const b = cp.budget;
          const unpriced = totals.requests - totals.pricedRequests;
          return (
            <>
              <SectionCard
                title={t('analytics.thisMonthAgainstYourLimits')}
                description={t('analytics.theCurrentCalendarMonthIndependent')}
                actions={
                  canBilling ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href="/settings/billing">{t('analytics.manageBudget')}</Link>
                    </Button>
                  ) : undefined
                }
              >
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-fg-muted">{t('analytics.planAiTokens')}</span>
                      <span className="font-medium tabular">
                        {fmt.compact(cp.tokensUsed)}
                        <span className="text-fg-subtle">
                          {' '}
                          /{' '}
                          {cp.planTokenLimit == null
                            ? t('common.noLimit')
                            : fmt.compact(cp.planTokenLimit)}
                        </span>
                        {cp.percentOfPlan != null ? (
                          <span className="ms-2 text-xs text-fg-subtle">
                            {Math.round(cp.percentOfPlan)}%
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <Meter
                      label={t('analytics.planAiTokensUsedThis')}
                      value={cp.tokensUsed}
                      max={cp.planTokenLimit}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="flex items-center gap-2 text-fg-muted">
                        {t('analytics.tokenBudget')}
                        {b.blocked ? (
                          <Badge variant="danger">{t('analytics.aiRequestsBlocked')}</Badge>
                        ) : null}
                        {!b.blocked && b.tokens.level !== 'ok' ? (
                          <Badge variant="warning">
                            {b.tokens.level === 'exceeded'
                              ? t('common.exceeded')
                              : t('common.warning')}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="font-medium tabular">
                        {b.tokens.budget == null ? (
                          <span className="text-fg-subtle">{t('analytics.noBudgetSet')}</span>
                        ) : (
                          <>
                            {fmt.compact(b.tokens.used)}
                            <span className="text-fg-subtle">
                              {' '}
                              / {fmt.compact(b.tokens.budget)}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    <Meter
                      label={t('common.tokenBudgetUsedThisMonth')}
                      value={b.tokens.used}
                      max={b.tokens.budget}
                    />
                  </div>
                </div>
                {b.cost.budgetUsd != null && !b.cost.enforceable ? (
                  <p className="mt-4 text-xs text-fg-muted" data-testid="usage-cost-budget-note">
                    {t('analytics.aCostBudgetIsSet')}
                  </p>
                ) : null}
              </SectionCard>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label={t('analytics.aiRequests')}
                  value={totals.requests}
                  hint={t('analytics.okErrors', {
                    successRequests: totals.successRequests,
                    errorRequests: totals.errorRequests,
                  })}
                />
                <StatCard
                  label={t('analytics.totalTokens')}
                  value={totals.totalTokens}
                  hint={t('common.inOut', {
                    formatCompact: fmt.compact(totals.inputTokens),
                    formatCompact2: fmt.compact(totals.outputTokens),
                  })}
                />
                <StatCard
                  label={t('common.estimatedCost')}
                  value={formatUsd(totals.costUsd, fmt)}
                  hint={
                    totals.costUsd == null
                      ? t('analytics.notAvailable')
                      : t('analytics.requestsPriced', {
                          pricedRequests: totals.pricedRequests,
                          requests: totals.requests,
                        })
                  }
                />
                <StatCard
                  label={t('analytics.shareOfPlanTokens')}
                  value={pct(cp.percentOfPlan == null ? null : cp.percentOfPlan / 100, fmt)}
                  hint={t('analytics.thisMonth')}
                />
              </div>

              {!d.pricingConfigured ? (
                <ReportNote title={t('analytics.costIsNotAvailable')} testId="usage-cost-note">
                  {t('analytics.noModelPricingIsConfigured')}
                </ReportNote>
              ) : unpriced > 0 ? (
                <ReportNote title={t('analytics.partialCostCoverage')} testId="usage-cost-note">
                  {t('analytics.ofRequestsUsedAModel', { unpriced, requests: totals.requests })}
                </ReportNote>
              ) : null}

              <SectionCard
                title={t('analytics.tokensOverTime')}
                description={t('analytics.inputAndOutputTokensPer')}
                actions={<ExportButtons report="usage" ctx={ctx} label={t('analytics.usage')} />}
              >
                {totals.requests === 0 ? (
                  <EmptyState
                    compact
                    icon={<Cpu />}
                    title={t('analytics.noAiUsageInThis')}
                    description={t('analytics.requestsFromTheAssistantAnd')}
                  />
                ) : (
                  <AreaChart
                    data={d.series.map((p) => ({ ...p }))}
                    xKey="bucket"
                    height={240}
                    labelFormatter={(l) => bucketLabel(l, ctx.granularity, fmt, t)}
                    series={[
                      { key: 'inputTokens', label: t('analytics.inputTokens') },
                      { key: 'outputTokens', label: t('analytics.outputTokens') },
                    ]}
                  />
                )}
              </SectionCard>

              {totals.requests > 0 ? (
                <>
                  <SectionCard title={t('common.byModel')} flush>
                    <DataTable
                      caption={t('analytics.usageByModel')}
                      rows={d.byModel}
                      rowKey={(r) => `${r.provider}/${r.model}`}
                      columns={[
                        { header: t('common.model'), render: (r) => `${r.provider} / ${r.model}` },
                        { header: t('common.requests'), align: 'right', render: (r) => r.requests },
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
                  <div className="grid gap-6 lg:grid-cols-2">
                    <SectionCard
                      title={t('common.byAgent')}
                      description={t('analytics.assistantAndOtherNonAgent')}
                      flush
                    >
                      <DataTable
                        caption={t('analytics.usageByAgent')}
                        rows={d.byAgent}
                        rowKey={(r) => r.agentId ?? 'none'}
                        columns={[
                          {
                            header: t('common.agent'),
                            render: (r) => r.name ?? t('analytics.assistantAndOtherCalls'),
                          },
                          {
                            header: t('common.requests'),
                            align: 'right',
                            render: (r) => r.requests,
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
                    <SectionCard title={t('analytics.byUser')} flush>
                      <DataTable
                        caption={t('analytics.usageByUser')}
                        rows={d.byUser}
                        rowKey={(r, i) => r.userId ?? `none-${i}`}
                        columns={[
                          {
                            header: t('analytics.user'),
                            render: (r) => r.name ?? 'System / unknown',
                          },
                          {
                            header: t('common.requests'),
                            align: 'right',
                            render: (r) => r.requests,
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
              ) : null}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
