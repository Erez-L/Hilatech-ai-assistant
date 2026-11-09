'use client';

import * as React from 'react';
import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
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
  formatCompact,
  formatCurrency,
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

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const PERIOD_WORDS: Record<DashboardPeriod, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
};

export function DashboardView() {
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
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={`${greeting}${user ? `, ${user.firstName}` : ''}`}
        description={org ? `Here’s where ${org.name} stands today.` : undefined}
        actions={
          <>
            <SegmentedControl
              aria-label="Period"
              options={PERIODS}
              value={period}
              onValueChange={setPeriod}
            />
            {canInvite ? (
              <Button asChild variant="secondary" leadingIcon={<MailPlus aria-hidden />}>
                <Link href="/team?invite=1">Invite a teammate</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {canAnalytics ? (
        <QueryState
          query={dashboard}
          loading={<DashboardSkeleton />}
          errorTitle="The overview couldn’t be loaded"
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
          title="Analytics are restricted"
          description="Your role can’t view organization analytics. Ask an admin for the analytics permission."
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Recent activity */}
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>What happened in this organization lately.</CardDescription>
            </div>
            {canAudit ? (
              <Button asChild variant="ghost" size="sm" trailingIcon={<ArrowRight aria-hidden />}>
                <Link href="/audit">Audit log</Link>
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
                        <Skeleton className="ml-auto h-3 w-16" />
                      </li>
                    ))}
                  </ul>
                }
                isEmpty={(r) => r.data.length === 0}
                empty={
                  <EmptyState
                    compact
                    icon={<ScrollText />}
                    title="No activity yet"
                    description="Actions like invitations, role changes and sign-ins will show up here."
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
                          {describeAuditAction(log.action)}
                        </span>
                        <time
                          dateTime={log.createdAt}
                          className="shrink-0 text-xs text-fg-subtle tabular"
                        >
                          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
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
                title="Activity is restricted"
                description="Your role can’t view the audit log."
              />
            )}
          </CardContent>
        </Card>

        {/* Usage */}
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>Usage this period</CardTitle>
              <CardDescription>Against your current plan limits.</CardDescription>
            </div>
            {canBilling ? (
              <Button asChild variant="ghost" size="sm" trailingIcon={<ArrowRight aria-hidden />}>
                <Link href="/settings/billing">Billing</Link>
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
                    const { label, format: fmt } = USAGE_LABELS[metric];
                    return (
                      <li key={metric} className="flex flex-col gap-2">
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="text-fg-muted">{label}</span>
                          <span className="font-medium tabular">
                            {fmt(entry.used)}
                            <span className="text-fg-subtle">
                              {' '}
                              / {entry.limit == null ? 'unlimited' : fmt(entry.limit)}
                            </span>
                          </span>
                        </div>
                        <Meter label={label} value={entry.used} max={entry.limit} size="sm" />
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
  const words = PERIOD_WORDS[period];
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
          Overview
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Open leads"
            value={d.leads.open}
            icon={<Target />}
            hint={`${formatCompact(d.leads.newInPeriod)} new in the ${words}`}
          />
          <StatCard
            label="Pipeline value"
            value={formatCurrency(d.leads.pipelineValue, currency, { compact: true })}
            icon={<Wallet />}
            hint={`Across ${formatCompact(d.leads.open)} open lead${d.leads.open === 1 ? '' : 's'}`}
          />
          <StatCard
            label={`Won · ${words}`}
            value={d.leads.wonInPeriod}
            icon={<Trophy />}
            hint={
              d.leads.wonInPeriod > 0
                ? `${formatCurrency(d.leads.wonValueInPeriod, currency, { compact: true })} closed · ${d.leads.lostInPeriod} lost`
                : d.leads.lostInPeriod > 0
                  ? `${d.leads.lostInPeriod} lost`
                  : 'Nothing closed yet'
            }
          />
          <StatCard
            label="Open conversations"
            value={d.conversations.open}
            icon={<MessageSquare />}
            hint={`${formatCompact(d.conversations.pending)} pending · ${formatCompact(d.conversations.newInPeriod)} new in the ${words}`}
          />
          <StatCard
            label="Unassigned conversations"
            value={d.conversations.unassigned}
            icon={<UserRoundX />}
            hint={
              d.conversations.unassigned > 0 ? 'Waiting for an owner' : 'Everything has an owner'
            }
          />
          <StatCard
            label="Team members"
            value={d.members.active}
            icon={<Users />}
            hint={[
              d.invitations.pending > 0
                ? `${d.invitations.pending} invitation${d.invitations.pending === 1 ? '' : 's'} pending`
                : 'No pending invitations',
              d.members.suspended > 0 ? `${d.members.suspended} suspended` : null,
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
              <CardTitle>New leads</CardTitle>
              <CardDescription>Per day over the {words}.</CardDescription>
            </div>
            <span className="text-2xl leading-none font-semibold tracking-tight tabular">
              {formatCompact(d.leads.newInPeriod)}
            </span>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={series}
              xKey="date"
              series={[{ key: 'leads', label: 'Leads' }]}
              height={180}
              labelFormatter={shortDay}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>New conversations</CardTitle>
              <CardDescription>Per day over the {words}.</CardDescription>
            </div>
            <span className="text-2xl leading-none font-semibold tracking-tight tabular">
              {formatCompact(d.conversations.newInPeriod)}
            </span>
          </CardHeader>
          <CardContent>
            <AreaChart
              data={series}
              xKey="date"
              series={[
                { key: 'conversations', label: 'Conversations', color: 'var(--color-chart-3)' },
              ]}
              height={180}
              labelFormatter={shortDay}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Leads by stage</CardTitle>
            <CardDescription>All leads, across every period.</CardDescription>
          </CardHeader>
          <CardContent>
            {d.leads.total === 0 ? (
              <EmptyState
                compact
                icon={<Target />}
                title="No leads yet"
                description="The pipeline fills in as leads are added."
                action={
                  canLeads ? (
                    <Button asChild size="sm" variant="secondary">
                      <Link href="/leads?new=1">New lead</Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <BarChart
                data={byStatus}
                xKey="status"
                series={[{ key: 'leads', label: 'Leads' }]}
                height={220}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between">
              <div className="flex flex-col gap-1">
                <CardTitle>Recent leads</CardTitle>
                <CardDescription>Latest additions.</CardDescription>
              </div>
              {canLeads ? (
                <Button asChild variant="ghost" size="sm" trailingIcon={<ArrowRight aria-hidden />}>
                  <Link href="/leads">All leads</Link>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {d.recentLeads.length === 0 ? (
                <EmptyState compact icon={<Target />} title="No leads yet" />
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
                        <span className="w-20 shrink-0 text-right text-xs text-fg-muted tabular">
                          {lead.value != null
                            ? formatCurrency(lead.value, lead.currency, { compact: true })
                            : format(new Date(lead.createdAt), 'd MMM')}
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
                <CardTitle>Recent conversations</CardTitle>
                <CardDescription>Latest activity.</CardDescription>
              </div>
              {canConversations ? (
                <Button asChild variant="ghost" size="sm" trailingIcon={<ArrowRight aria-hidden />}>
                  <Link href="/conversations">Inbox</Link>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {d.recentConversations.length === 0 ? (
                <EmptyState compact icon={<Inbox />} title="No conversations yet" />
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
                          title={CONVERSATION_CHANNEL_LABELS[c.channel]}
                        >
                          <ChannelIcon channel={c.channel} className="size-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {c.subject || 'No subject'}
                        </span>
                        <ConversationStatusBadge
                          status={c.status}
                          className="px-1.5 py-0 text-[0.625rem] leading-4"
                        />
                        <span className="w-16 shrink-0 text-right text-xs text-fg-muted tabular">
                          {c.lastMessageAt
                            ? formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: false })
                            : '—'}
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
