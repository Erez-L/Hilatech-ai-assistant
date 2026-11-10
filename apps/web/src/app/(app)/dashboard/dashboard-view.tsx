'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Inbox,
  MailPlus,
  MessageSquare,
  ScrollText,
  Target,
  Trophy,
  UserRoundX,
  Users,
  Wallet,
} from 'lucide-react';
import { Permission, type DashboardPeriod, type DashboardSummary } from '@hilatech/contracts';
import {
  AreaChart,
  Badge,
  BarChart,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Meter,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatCard,
} from '@hilatech/ui';
import { useAuditLogs, useDashboard, useUsage } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { useSession } from '@/stores/session';
import { QueryState } from '@/components/common/query-state';
import { auditTone, describeAuditAction } from '@/lib/audit-labels';
import {
  CONVERSATION_CHANNEL_LABELS,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  shortDay,
} from '@/lib/crm';
import { ConversationStatusBadge, LeadStatusBadge } from '@/components/crm/badges';
import { ChannelIcon } from '@/components/crm/channel-icon';
import { USAGE_LABELS } from '@/lib/usage-labels';
import { useT, useFormat } from '@/i18n/provider';
import { msg, type Msg } from '@/i18n/msg';

const PERIODS: { value: DashboardPeriod; label: Msg }[] = [
  { value: '7d', label: msg('dashboard.n7Days') },
  { value: '30d', label: msg('dashboard.n30Days') },
  { value: '90d', label: msg('dashboard.n90Days') },
];

const PERIOD_WORDS: Record<DashboardPeriod, Msg> = {
  '7d': msg('dashboard.periodWords7d'),
  '30d': msg('dashboard.periodWords30d'),
  '90d': msg('dashboard.periodWords90d'),
};

export function DashboardView() {
  const fmt = useFormat();
  const t = useT();
  const user = useSession((s) => s.user);
  const org = useSession((s) => s.activeOrganization);
  const canInvite = useCan(Permission.MEMBERS_INVITE);
  const canAudit = useCan(Permission.AUDIT_READ);
  const canBilling = useCan(Permission.ORG_BILLING_MANAGE);
  const canAnalytics = useCan(Permission.ANALYTICS_READ);
  const canLeads = useCan(Permission.LEADS_READ);
  const canConversations = useCan(Permission.CONVERSATIONS_READ);

  const [period, setPeriod] = React.useState<DashboardPeriod>('30d');
  const dashboard = useDashboard(period, { enabled: canAnalytics });
  const usage = useUsage();
  const audit = useAuditLogs({ page: 1, pageSize: 8 });

  const hour = new Date().getHours();
  const greeting = t(
    hour < 12
      ? 'dashboard.greetingMorning'
      : hour < 18
        ? 'dashboard.greetingAfternoon'
        : 'dashboard.greetingEvening',
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={
          user ? t('dashboard.greetingWithName', { greeting, name: user.firstName }) : greeting
        }
        description={org ? t('dashboard.hereSWhereStandsToday', { name: org.name }) : undefined}
        actions={
          <>
            <SegmentedControl
              aria-label={t('dashboard.period')}
              options={PERIODS.map((o) => ({ ...o, label: t(o.label) }))}
              value={period}
              onValueChange={setPeriod}
            />
            {canInvite ? (
              <Button asChild variant="secondary" leadingIcon={<MailPlus aria-hidden />}>
                <Link href="/team?invite=1">{t('common.inviteATeammate')}</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {canAnalytics ? (
        <QueryState
          query={dashboard}
          loading={<DashboardSkeleton />}
          errorTitle={t('dashboard.theOverviewCouldnTBe')}
        >
          {(d) => (
            <DashboardBody
              data={d}
              period={period}
              canLeads={canLeads}
              canConversations={canConversations}
              refreshing={dashboard.isFetching}
            />
          )}
        </QueryState>
      ) : (
        <EmptyState
          icon={<Target />}
          title={t('dashboard.analyticsAreRestricted')}
          description={t('dashboard.yourRoleCanTView')}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Recent activity */}
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>{t('dashboard.recentActivity')}</CardTitle>
              <CardDescription>{t('dashboard.whatHappenedInThisOrganization')}</CardDescription>
            </div>
            {canAudit ? (
              <Button asChild variant="ghost" size="sm" trailingIcon={<ArrowRight aria-hidden />}>
                <Link href="/audit">{t('common.auditLog')}</Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="p-0">
            {canAudit ? (
              <QueryState
                query={audit}
                compact
                loading={
                  <ul className="divide-y divide-border">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <li key={i} className="flex items-center gap-3 px-5 py-3">
                        <Skeleton className="size-2 rounded-full" />
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="ms-auto h-3 w-16" />
                      </li>
                    ))}
                  </ul>
                }
                isEmpty={(r) => r.data.length === 0}
                empty={
                  <EmptyState
                    compact
                    icon={<ScrollText />}
                    title={t('dashboard.noActivityYet')}
                    description={t('dashboard.actionsLikeInvitationsRoleChanges')}
                  />
                }
              >
                {(r) => (
                  <ul className="divide-y divide-border">
                    {r.data.map((log) => (
                      <li key={log.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                        <Badge variant={auditTone(log.action)} dot className="shrink-0">
                          {log.action.split('.')[0]}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate">
                          {describeAuditAction(log.action, t)}
                        </span>
                        <time
                          dateTime={log.createdAt}
                          className="shrink-0 text-xs text-fg-subtle tabular"
                        >
                          {fmt.relative(new Date(log.createdAt))}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </QueryState>
            ) : (
              <EmptyState
                compact
                icon={<ScrollText />}
                title={t('dashboard.activityIsRestricted')}
                description={t('dashboard.yourRoleCanTView2')}
              />
            )}
          </CardContent>
        </Card>

        {/* Usage */}
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>{t('dashboard.usageThisPeriod')}</CardTitle>
              <CardDescription>{t('dashboard.againstYourCurrentPlanLimits')}</CardDescription>
            </div>
            {canBilling ? (
              <Button asChild variant="ghost" size="sm" trailingIcon={<ArrowRight aria-hidden />}>
                <Link href="/settings/billing">{t('dashboard.billing')}</Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            <QueryState
              query={usage}
              compact
              loading={
                <div className="flex flex-col gap-5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-2 w-full" />
                    </div>
                  ))}
                </div>
              }
            >
              {(u) => (
                <ul className="flex flex-col gap-5">
                  {(Object.keys(USAGE_LABELS) as (keyof typeof USAGE_LABELS)[]).map((metric) => {
                    const entry = u.metrics[metric];
                    if (!entry) return null;
                    const { label, unit } = USAGE_LABELS[metric];
                    const fmtUsage = (n: number) =>
                      unit === 'mb' ? fmt.bytesFromMb(n) : fmt.compact(n);
                    return (
                      <li key={metric} className="flex flex-col gap-2">
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="text-fg-muted">{t(label)}</span>
                          <span className="font-medium tabular">
                            {fmtUsage(entry.used)}
                            <span className="text-fg-subtle">
                              {' '}
                              /{' '}
                              {entry.limit == null
                                ? t('dashboard.unlimited')
                                : fmtUsage(entry.limit)}
                            </span>
                          </span>
                        </div>
                        <Meter label={t(label)} value={entry.used} max={entry.limit} size="sm" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatCard key={i} label={<Skeleton className="h-4 w-20" />} value={null} loading />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

function DashboardBody({
  data: d,
  period,
  canLeads,
  canConversations,
  refreshing,
}: {
  data: DashboardSummary;
  period: DashboardPeriod;
  canLeads: boolean;
  canConversations: boolean;
  refreshing: boolean;
}) {
  const fmt = useFormat();
  const t = useT();
  const words = t(PERIOD_WORDS[period]);
  const currency = d.leads.currency;

  const series = React.useMemo(() => {
    const byDate = new Map<string, { date: string; leads: number; conversations: number }>();
    for (const p of d.series.leadsCreated)
      byDate.set(p.date, { date: p.date, leads: p.count, conversations: 0 });
    for (const p of d.series.conversationsCreated) {
      const row = byDate.get(p.date) ?? { date: p.date, leads: 0, conversations: 0 };
      row.conversations = p.count;
      byDate.set(p.date, row);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [d.series]);

  const byStatus = React.useMemo(
    () =>
      LEAD_STATUSES.map((status) => ({
        status: LEAD_STATUS_LABELS[status],
        leads: d.leads.byStatus[status] ?? 0,
      })),
    [d.leads.byStatus],
  );

  return (
    <div className="flex flex-col gap-6" aria-busy={refreshing || undefined}>
      {/* Stats */}
      <section aria-labelledby="overview" className="flex flex-col gap-3">
        <h2 id="overview" className="sr-only">
          {t('dashboard.overview')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label={t('dashboard.openLeads')}
            value={d.leads.open}
            icon={<Target />}
            hint={t('dashboard.newInThe', {
              formatCompact: fmt.compact(d.leads.newInPeriod),
              words,
            })}
          />
          <StatCard
            label={t('dashboard.pipelineValue')}
            value={fmt.currency(d.leads.pipelineValue, currency, { compact: true })}
            icon={<Wallet />}
            hint={t('dashboard.acrossOpenLeads', { count: d.leads.open })}
          />
          <StatCard
            label={t('dashboard.won', { words })}
            value={d.leads.wonInPeriod}
            icon={<Trophy />}
            hint={
              d.leads.wonInPeriod > 0
                ? t('dashboard.closedLost', {
                    formatCurrency: fmt.currency(d.leads.wonValueInPeriod, currency, {
                      compact: true,
                    }),
                    lostInPeriod: d.leads.lostInPeriod,
                  })
                : d.leads.lostInPeriod > 0
                  ? t('dashboard.lost', { lostInPeriod: d.leads.lostInPeriod })
                  : t('dashboard.nothingClosedYet')
            }
          />
          <StatCard
            label={t('dashboard.openConversations')}
            value={d.conversations.open}
            icon={<MessageSquare />}
            hint={t('dashboard.pendingNewInThe', {
              formatCompact: fmt.compact(d.conversations.pending),
              formatCompact2: fmt.compact(d.conversations.newInPeriod),
              words,
            })}
          />
          <StatCard
            label={t('dashboard.unassignedConversations')}
            value={d.conversations.unassigned}
            icon={<UserRoundX />}
            hint={
              d.conversations.unassigned > 0
                ? t('dashboard.waitingForAnOwner')
                : t('dashboard.everythingHasAnOwner')
            }
          />
          <StatCard
            label={t('dashboard.teamMembers')}
            value={d.members.active}
            icon={<Users />}
            hint={[
              d.invitations.pending > 0
                ? t('dashboard.invitationsPending', { count: d.invitations.pending })
                : t('dashboard.noPendingInvitations'),
              d.members.suspended > 0
                ? t('dashboard.suspendedCount', { count: d.members.suspended })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        </div>
      </section>

      {/* Trends */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>{t('dashboard.newLeads')}</CardTitle>
              <CardDescription>{t('dashboard.perDayOverThe', { words })}</CardDescription>
            </div>
            <span className="text-2xl leading-none font-semibold tracking-tight tabular">
              {fmt.compact(d.leads.newInPeriod)}
            </span>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={series}
              xKey="date"
              series={[{ key: 'leads', label: t('common.leads') }]}
              height={180}
              labelFormatter={(label) => shortDay(label, fmt)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>{t('dashboard.newConversations')}</CardTitle>
              <CardDescription>{t('dashboard.perDayOverThe', { words })}</CardDescription>
            </div>
            <span className="text-2xl leading-none font-semibold tracking-tight tabular">
              {fmt.compact(d.conversations.newInPeriod)}
            </span>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={series}
              xKey="date"
              series={[
                {
                  key: 'conversations',
                  label: t('common.conversations'),
                  color: 'var(--color-chart-3)',
                },
              ]}
              height={180}
              labelFormatter={(label) => shortDay(label, fmt)}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.leadsByStage')}</CardTitle>
            <CardDescription>{t('dashboard.allLeadsAcrossEveryPeriod')}</CardDescription>
          </CardHeader>
          <CardContent>
            {d.leads.total === 0 ? (
              <EmptyState
                compact
                icon={<Target />}
                title={t('common.noLeadsYet')}
                description={t('dashboard.thePipelineFillsInAs')}
                action={
                  canLeads ? (
                    <Button asChild size="sm" variant="secondary">
                      <Link href="/leads?new=1">{t('common.newLead')}</Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <BarChart
                data={byStatus}
                xKey="status"
                series={[{ key: 'leads', label: t('common.leads') }]}
                height={220}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between">
              <div className="flex flex-col gap-1">
                <CardTitle>{t('dashboard.recentLeads')}</CardTitle>
                <CardDescription>{t('dashboard.latestAdditions')}</CardDescription>
              </div>
              {canLeads ? (
                <Button asChild variant="ghost" size="sm" trailingIcon={<ArrowRight aria-hidden />}>
                  <Link href="/leads">{t('common.allLeads')}</Link>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {d.recentLeads.length === 0 ? (
                <EmptyState compact icon={<Target />} title={t('common.noLeadsYet')} />
              ) : (
                <ul className="divide-y divide-border">
                  {d.recentLeads.map((lead) => (
                    <li key={lead.id}>
                      <Link
                        href={`/leads/${lead.id}`}
                        className="flex items-center gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-surface-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{lead.title}</span>
                        <LeadStatusBadge
                          status={lead.status}
                          className="px-1.5 py-0 text-[0.625rem] leading-4"
                        />
                        <span className="w-20 shrink-0 text-end text-xs text-fg-muted tabular">
                          {lead.value != null
                            ? fmt.currency(lead.value, lead.currency, { compact: true })
                            : fmt.dayMonth(new Date(lead.createdAt))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-start justify-between">
              <div className="flex flex-col gap-1">
                <CardTitle>{t('dashboard.recentConversations')}</CardTitle>
                <CardDescription>{t('dashboard.latestActivity')}</CardDescription>
              </div>
              {canConversations ? (
                <Button asChild variant="ghost" size="sm" trailingIcon={<ArrowRight aria-hidden />}>
                  <Link href="/conversations">{t('dashboard.inbox')}</Link>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {d.recentConversations.length === 0 ? (
                <EmptyState compact icon={<Inbox />} title={t('common.noConversationsYet')} />
              ) : (
                <ul className="divide-y divide-border">
                  {d.recentConversations.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/conversations?c=${c.id}`}
                        className="flex items-center gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-surface-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                      >
                        <span
                          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-muted"
                          title={t(CONVERSATION_CHANNEL_LABELS[c.channel])}
                        >
                          <ChannelIcon channel={c.channel} className="size-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {c.subject || t('common.noSubject')}
                        </span>
                        <ConversationStatusBadge
                          status={c.status}
                          className="px-1.5 py-0 text-[0.625rem] leading-4"
                        />
                        <span className="w-16 shrink-0 text-end text-xs text-fg-muted tabular">
                          {c.lastMessageAt ? fmt.relative(new Date(c.lastMessageAt)) : '—'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
