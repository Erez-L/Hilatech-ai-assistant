'use client';

import * as React from 'react';
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
import { enumLabel } from '@/i18n/enums';
import { msg, type Msg } from '@/i18n/msg';
import { useT, useFormat } from '@/i18n/provider';
import { formatLimit } from '@/lib/billing';

const PLAN_ORDER: PlanKey[] = ['free', 'starter', 'pro', 'enterprise'];
const PLAN_BLURB: Record<PlanKey, Msg> = {
  free: msg('settings.planBlurbFree'),
  starter: msg('settings.planBlurbStarter'),
  pro: msg('settings.planBlurbPro'),
  enterprise: msg('settings.planBlurbEnterprise'),
};
const LIMIT_ROWS = PLAN_LIMIT_ROWS;

export function BillingView() {
  const t = useT();
  const subscription = useSubscription();
  const plans = usePlans();

  return (
    <PermissionGate anyOf={[Permission.ORG_READ, Permission.ORG_BILLING_MANAGE]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('settings.settings')}
          description={t('settings.yourPlanWhatItIncludes')}
        >
          <SettingsTabs />
        </PageHeader>

        <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
          <QueryState
            query={subscription}
            loading={<PlanSkeleton />}
            errorTitle={t('settings.yourSubscriptionCouldnTBe')}
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
            <CardTitle id="compare-title">{t('settings.comparePlans')}</CardTitle>
            <CardDescription>{t('settings.limitsPerOrganizationEnterpriseLimits')}</CardDescription>
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
  const fmt = useFormat();
  const t = useT();
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('settings.currentPlan')}</CardTitle>
          <CardDescription>
            {t('settings.renewsOn', { date: fmt.date(new Date(subscription.currentPeriodEnd)) })}
            {subscription.cancelAtPeriodEnd ? t('settings.cancelsAtPeriodEnd') : ''}
          </CardDescription>
        </div>
        <StatusBadge status={subscription.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold tracking-tight">
            {enumLabel(t, 'plan', subscription.plan)}
          </span>
          <span className="text-sm text-fg-muted">{t(PLAN_BLURB[subscription.plan])}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          {LIMIT_ROWS.map((row) => (
            <div key={row.key} className="flex flex-col">
              <dt className="text-xs text-fg-muted">{t(row.label)}</dt>
              <dd className="font-medium tabular">
                {formatLimit(row, subscription.limits[row.key], fmt)}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
          <Button asChild variant="secondary" leadingIcon={<Mail aria-hidden />}>
            <a href="mailto:sales@hilatech.dev?subject=HilaTech%20AI%20Assistant%20plan%20change">
              {t('settings.contactSales')}
            </a>
          </Button>
          <Button asChild variant="ghost" leadingIcon={<ArrowDown aria-hidden />}>
            <a href="#upgrade">{t('settings.seeUpgradeOptions')}</a>
          </Button>
        </div>
        {subscription.provider ? (
          <p className="text-xs text-fg-subtle">
            {t('settings.managedBy', { provider: subscription.provider })}
          </p>
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
  const fmt = useFormat();
  const t = useT();
  const available = PLAN_ORDER.filter((k): k is PlanKey => !!plans[k]);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-48">{t('settings.limit')}</TableHead>
          {available.map((k) => (
            <TableHead key={k} className="text-end">
              <span className="inline-flex items-center gap-1.5">
                {enumLabel(t, 'plan', k)}
                {k === current ? (
                  <Badge variant="accent" className="px-1.5 py-0 text-[0.625rem] leading-4">
                    <Check aria-hidden />
                    {t('settings.current')}
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
            <TableCell className="text-fg-muted">{t(row.label)}</TableCell>
            {available.map((k) => (
              <TableCell
                key={k}
                className={cn('text-end tabular', k === current && 'bg-accent-soft/30 font-medium')}
              >
                {formatLimit(row, plans[k]![row.key], fmt)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
