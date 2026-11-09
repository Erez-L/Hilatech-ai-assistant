'use client';

import Link from 'next/link';
import { Cpu } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import { AreaChart, Badge, Button, EmptyState, Meter, StatCard, formatCompact } from '@hilatech/ui';
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

export function UsageTab({ ctx }: { ctx: ReportContext }) {
  const query = useUsageAnalytics(ctx.params);
  const canBilling = useCan(Permission.ORG_BILLING_MANAGE);
  return (
    <div className="flex flex-col gap-6" aria-busy={query.isFetching}>
      <QueryState
        query={query}
        loading={<ReportSkeleton />}
        errorTitle="Usage analytics couldn’t be loaded"
      >
        {(d) => {
          const t = d.totals;
          const cp = d.currentPeriod;
          const b = cp.budget;
          const unpriced = t.requests - t.pricedRequests;
          return (
            <>
              <SectionCard
                title="This month against your limits"
                description="The current calendar month, independent of the selected date range."
                actions={
                  canBilling ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href="/settings/billing">Manage budget</Link>
                    </Button>
                  ) : undefined
                }
              >
                <div className="grid gap-6 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-fg-muted">Plan AI tokens</span>
                      <span className="font-medium tabular">
                        {formatCompact(cp.tokensUsed)}
                        <span className="text-fg-subtle">
                          {' '}
                          /{' '}
                          {cp.planTokenLimit == null
                            ? 'no limit'
                            : formatCompact(cp.planTokenLimit)}
                        </span>
                        {cp.percentOfPlan != null ? (
                          <span className="ml-2 text-xs text-fg-subtle">
                            {Math.round(cp.percentOfPlan)}%
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <Meter
                      label="Plan AI tokens used this month"
                      value={cp.tokensUsed}
                      max={cp.planTokenLimit}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="flex items-center gap-2 text-fg-muted">
                        Token budget
                        {b.blocked ? <Badge variant="danger">AI requests blocked</Badge> : null}
                        {!b.blocked && b.tokens.level !== 'ok' ? (
                          <Badge variant="warning">
                            {b.tokens.level === 'exceeded' ? 'Exceeded' : 'Warning'}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="font-medium tabular">
                        {b.tokens.budget == null ? (
                          <span className="text-fg-subtle">No budget set</span>
                        ) : (
                          <>
                            {formatCompact(b.tokens.used)}
                            <span className="text-fg-subtle">
                              {' '}
                              / {formatCompact(b.tokens.budget)}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    <Meter
                      label="Token budget used this month"
                      value={b.tokens.used}
                      max={b.tokens.budget}
                    />
                  </div>
                </div>
                {b.cost.budgetUsd != null && !b.cost.enforceable ? (
                  <p className="mt-4 text-xs text-fg-muted" data-testid="usage-cost-budget-note">
                    A cost budget is set, but it cannot be measured or enforced until model pricing
                    is configured.
                  </p>
                ) : null}
              </SectionCard>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="AI requests"
                  value={t.requests}
                  hint={`${t.successRequests} ok · ${t.errorRequests} errors`}
                />
                <StatCard
                  label="Total tokens"
                  value={t.totalTokens}
                  hint={`${formatCompact(t.inputTokens)} in · ${formatCompact(t.outputTokens)} out`}
                />
                <StatCard
                  label="Estimated cost"
                  value={formatUsd(t.costUsd)}
                  hint={
                    t.costUsd == null
                      ? 'Not available'
                      : `${t.pricedRequests}/${t.requests} requests priced`
                  }
                />
                <StatCard
                  label="Share of plan tokens"
                  value={pct(cp.percentOfPlan == null ? null : cp.percentOfPlan / 100)}
                  hint="this month"
                />
              </div>

              {!d.pricingConfigured ? (
                <ReportNote title="Cost is not available" testId="usage-cost-note">
                  No model pricing is configured, so no cost is estimated and a cost budget cannot
                  be enforced. Token counts are exact.
                </ReportNote>
              ) : unpriced > 0 ? (
                <ReportNote title="Partial cost coverage" testId="usage-cost-note">
                  {unpriced} of {t.requests} requests used a model without a configured price, so
                  the cost total is a lower bound.
                </ReportNote>
              ) : null}

              <SectionCard
                title="Tokens over time"
                description="Input and output tokens per period (UTC)."
                actions={<ExportButtons report="usage" ctx={ctx} label="usage" />}
              >
                {t.requests === 0 ? (
                  <EmptyState
                    compact
                    icon={<Cpu />}
                    title="No AI usage in this range"
                    description="Requests from the assistant and agents will be counted here. Widen the date range to see more."
                  />
                ) : (
                  <AreaChart
                    data={d.series.map((p) => ({ ...p }))}
                    xKey="bucket"
                    height={240}
                    labelFormatter={(l) => bucketLabel(l, ctx.granularity)}
                    series={[
                      { key: 'inputTokens', label: 'Input tokens' },
                      { key: 'outputTokens', label: 'Output tokens' },
                    ]}
                  />
                )}
              </SectionCard>

              {t.requests > 0 ? (
                <>
                  <SectionCard title="By model" flush>
                    <DataTable
                      caption="Usage by model"
                      rows={d.byModel}
                      rowKey={(r) => `${r.provider}/${r.model}`}
                      columns={[
                        { header: 'Model', render: (r) => `${r.provider} / ${r.model}` },
                        { header: 'Requests', align: 'right', render: (r) => r.requests },
                        {
                          header: 'Tokens',
                          align: 'right',
                          render: (r) => formatCompact(r.totalTokens),
                        },
                        { header: 'Cost', align: 'right', render: (r) => formatUsd(r.costUsd) },
                      ]}
                    />
                  </SectionCard>
                  <div className="grid gap-6 lg:grid-cols-2">
                    <SectionCard
                      title="By agent"
                      description="Assistant and other non-agent calls are grouped separately."
                      flush
                    >
                      <DataTable
                        caption="Usage by agent"
                        rows={d.byAgent}
                        rowKey={(r) => r.agentId ?? 'none'}
                        columns={[
                          { header: 'Agent', render: (r) => r.name ?? 'Assistant & other calls' },
                          { header: 'Requests', align: 'right', render: (r) => r.requests },
                          {
                            header: 'Tokens',
                            align: 'right',
                            render: (r) => formatCompact(r.totalTokens),
                          },
                          { header: 'Cost', align: 'right', render: (r) => formatUsd(r.costUsd) },
                        ]}
                      />
                    </SectionCard>
                    <SectionCard title="By user" flush>
                      <DataTable
                        caption="Usage by user"
                        rows={d.byUser}
                        rowKey={(r, i) => r.userId ?? `none-${i}`}
                        columns={[
                          { header: 'User', render: (r) => r.name ?? 'System / unknown' },
                          { header: 'Requests', align: 'right', render: (r) => r.requests },
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
              ) : null}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
