'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { ArrowDown, Check, Mail } from 'lucide-react';
import { Permission, type PlanKey, type PlanLimits, type Subscription } from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageHeader,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  humanize,
} from '@hilatech/ui';
import { usePlans, useSubscription } from '@/hooks/queries';
import { QueryState } from '@/components/common/query-state';
import { PermissionGate } from '@/components/common/permission-gate';
import { SettingsTabs } from '@/components/settings/settings-tabs';
import { PLAN_LIMIT_ROWS } from '@/lib/billing';
import { AlertsCard } from './alerts-card';
import { BudgetCard } from './budget-card';
import { EntitlementsCard } from './entitlements-card';
import { UpgradeCard } from './upgrade-card';

const PLAN_ORDER: PlanKey[] = ['free', 'starter', 'pro', 'enterprise'];
const PLAN_BLURB: Record<PlanKey, string> = {
  free: 'Try the assistant with a small team.',
  starter: 'For a growing business with one or two agents in production.',
  pro: 'Several teams, many agents, a large knowledge base.',
  enterprise: 'Custom limits, dedicated support and contractual commitments.',
};
const LIMIT_ROWS = PLAN_LIMIT_ROWS;

export function BillingView() {
  const subscription = useSubscription();
  const plans = usePlans();

  return (
    <PermissionGate anyOf={[Permission.ORG_READ, Permission.ORG_BILLING_MANAGE]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Settings"
          description="Your plan, what it includes, how much you use, and your AI budget."
        >
          <SettingsTabs />
        </PageHeader>

        <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
          <QueryState
            query={subscription}
            loading={<PlanSkeleton />}
            errorTitle="Your subscription couldn’t be loaded"
          >
            {(sub) => <CurrentPlanCard subscription={sub} />}
          </QueryState>
          <EntitlementsCard />
        </div>

        <BudgetCard />
        <UpgradeCard />
        <AlertsCard />

        <Card role="region" aria-labelledby="compare-title">
          <CardHeader>
            <CardTitle id="compare-title">Compare plans</CardTitle>
            <CardDescription>
              Limits per organization. Enterprise limits are negotiated.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <QueryState
              query={plans}
              compact
              loading={
                <div className="flex flex-col gap-3 p-5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                  ))}
                </div>
              }
            >
              {(p) => <PlansTable plans={p} current={subscription.data?.plan} />}
            </QueryState>
          </CardContent>
        </Card>
      </div>
    </PermissionGate>
  );
}

function PlanSkeleton() {
  return (
    <Card aria-busy>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}

function CurrentPlanCard({ subscription }: { subscription: Subscription }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>Current plan</CardTitle>
          <CardDescription>
            Renews {format(new Date(subscription.currentPeriodEnd), 'd MMM yyyy')}
            {subscription.cancelAtPeriodEnd ? ' · cancels at period end' : ''}
          </CardDescription>
        </div>
        <StatusBadge status={subscription.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold tracking-tight">
            {humanize(subscription.plan)}
          </span>
          <span className="text-sm text-fg-muted">{PLAN_BLURB[subscription.plan]}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          {LIMIT_ROWS.map((row) => (
            <div key={row.key} className="flex flex-col">
              <dt className="text-xs text-fg-muted">{row.label}</dt>
              <dd className="font-medium tabular">{row.format(subscription.limits[row.key])}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
          <Button asChild variant="secondary" leadingIcon={<Mail aria-hidden />}>
            <a href="mailto:sales@hilatech.dev?subject=HilaTech%20AI%20Assistant%20plan%20change">
              Contact sales
            </a>
          </Button>
          <Button asChild variant="ghost" leadingIcon={<ArrowDown aria-hidden />}>
            <a href="#upgrade">See upgrade options</a>
          </Button>
        </div>
        {subscription.provider ? (
          <p className="text-xs text-fg-subtle">Managed by {subscription.provider}.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PlansTable({
  plans,
  current,
}: {
  plans: Partial<Record<PlanKey, PlanLimits>>;
  current?: PlanKey;
}) {
  const available = PLAN_ORDER.filter((k): k is PlanKey => !!plans[k]);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-48">Limit</TableHead>
          {available.map((k) => (
            <TableHead key={k} className="text-right">
              <span className="inline-flex items-center gap-1.5">
                {humanize(k)}
                {k === current ? (
                  <Badge variant="accent" className="px-1.5 py-0 text-[0.625rem] leading-4">
                    <Check aria-hidden />
                    Current
                  </Badge>
                ) : null}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {LIMIT_ROWS.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="text-fg-muted">{row.label}</TableCell>
            {available.map((k) => (
              <TableCell
                key={k}
                className={cn(
                  'text-right tabular',
                  k === current && 'bg-accent-soft/30 font-medium',
                )}
              >
                {row.format(plans[k]![row.key])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
