'use client';

import * as React from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, Contact, MailPlus, MessageSquare, ScrollText, Target, Users } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Meter,
  PageHeader,
  Skeleton,
  StatCard,
  formatCompact,
} from '@hilatech/ui';
import { useAuditLogs, useDashboard, useUsage } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { useSession } from '@/stores/session';
import { QueryState } from '@/components/common/query-state';
import { auditTone, describeAuditAction } from '@/lib/audit-labels';
import { USAGE_LABELS } from '@/lib/usage-labels';

export function DashboardView() {
  const user = useSession((s) => s.user);
  const org = useSession((s) => s.activeOrganization);
  const canInvite = useCan(Permission.MEMBERS_INVITE);
  const canAudit = useCan(Permission.AUDIT_READ);
  const canBilling = useCan(Permission.ORG_BILLING_MANAGE);

  const dashboard = useDashboard();
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
          canInvite ? (
            <Button asChild variant="secondary" leadingIcon={<MailPlus aria-hidden />}>
              <Link href="/team?invite=1">Invite a teammate</Link>
            </Button>
          ) : undefined
        }
      />

      {/* Stats */}
      <section aria-labelledby="overview" className="flex flex-col gap-3">
        <h2 id="overview" className="sr-only">
          Overview
        </h2>
        <QueryState
          query={dashboard}
          loading={
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <StatCard key={i} label={<Skeleton className="h-4 w-20" />} value={null} loading />
              ))}
            </div>
          }
        >
          {(d) => (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Team members"
                value={d.members}
                icon={<Users />}
                hint={[
                  d.pendingInvitations > 0
                    ? `${d.pendingInvitations} invitation${d.pendingInvitations === 1 ? '' : 's'} pending`
                    : 'No pending invitations',
                  d.suspendedMembers > 0 ? `${d.suspendedMembers} suspended` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <StatCard
                label="Leads"
                value={d.leads}
                icon={<Target />}
                hint={
                  Object.keys(d.leadsByStatus).length > 0
                    ? Object.entries(d.leadsByStatus)
                        .map(([status, count]) => `${count} ${status.replace(/_/g, ' ')}`)
                        .join(' · ')
                    : 'Across all stages'
                }
              />
              <StatCard label="Contacts" value={d.contacts} icon={<Contact />} hint="In your address book" />
              <StatCard
                label="Open conversations"
                value={d.openConversations}
                icon={<MessageSquare />}
                hint={`${formatCompact(d.conversations)} total`}
              />
            </div>
          )}
        </QueryState>
      </section>

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
                        <span className="min-w-0 flex-1 truncate">{describeAuditAction(log.action)}</span>
                        <time dateTime={log.createdAt} className="shrink-0 text-xs text-fg-subtle tabular">
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
                    const { label, format } = USAGE_LABELS[metric];
                    return (
                      <li key={metric} className="flex flex-col gap-2">
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="text-fg-muted">{label}</span>
                          <span className="font-medium tabular">
                            {format(entry.used)}
                            <span className="text-fg-subtle"> / {entry.limit == null ? 'unlimited' : format(entry.limit)}</span>
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
