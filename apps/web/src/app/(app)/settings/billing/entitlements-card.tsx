'use client';

import type { EntitlementUsage } from '@hilatech/contracts';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Meter,
  Skeleton,
} from '@hilatech/ui';
import { useEntitlements } from '@/hooks/billing';
import { QueryState } from '@/components/common/query-state';
import {
  ENTITLEMENT_STATE_LABEL,
  entitlementStateNote,
  formatEntitlementValue,
} from '@/lib/billing';
import { enumLabel } from '@/i18n/enums';
import { useT, useFormat } from '@/i18n/provider';

const STATE_VARIANT = { ok: 'neutral', warning: 'warning', exceeded: 'danger' } as const;

export function EntitlementsCard() {
  const t = useT();
  const fmt = useFormat();
  const query = useEntitlements();
  return (
    <Card role="region" aria-labelledby="entitlements-title">
      <CardHeader>
        <CardTitle id="entitlements-title">{t('settings.planUsage')}</CardTitle>
        <CardDescription>
          {query.data
            ? t('settings.monthWarningFrom80', {
                dayMonth: fmt.dayMonth(new Date(query.data.periodStart)),
                date: fmt.date(new Date(query.data.periodEnd)),
              })
            : t('settings.whatYourPlanIncludesAnd')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={query}
          compact
          errorTitle={t('settings.planUsageCouldnTBe')}
          loading={
            <div
              className="flex flex-col gap-5"
              aria-busy="true"
              aria-label={t('settings.loadingPlanUsage')}
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-2 w-full" />
                </div>
              ))}
            </div>
          }
        >
          {(overview) => (
            <ul className="flex flex-col gap-5" aria-label={t('settings.entitlements')}>
              {overview.entitlements.map((e) => (
                <EntitlementRow key={e.key} entitlement={e} />
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

export function EntitlementRow({ entitlement: e }: { entitlement: EntitlementUsage }) {
  const t = useT();
  const format = useFormat();
  const note = entitlementStateNote(e, t);
  // The API sends English labels; translate by key and fall back to what it sent.
  const label = enumLabel(t, 'billing.entitlement', e.key, e.label);
  const fmt = (n: number) => formatEntitlementValue(e.unit, n, format);
  return (
    <li className="flex flex-col gap-2" data-testid={`entitlement-${e.key}`} data-state={e.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-2">
          <span className="text-fg-muted">{label}</span>
          {e.state !== 'ok' ? (
            <Badge variant={STATE_VARIANT[e.state]} dot>
              {t(ENTITLEMENT_STATE_LABEL[e.state])}
            </Badge>
          ) : null}
        </span>
        <span className="font-medium tabular">
          <bdi dir="ltr">{fmt(e.used)}</bdi>
          <span className="text-fg-subtle">
            {' '}
            / {e.limit == null ? t('common.noLimit') : <bdi dir="ltr">{fmt(e.limit)}</bdi>}
          </span>
          {e.percent != null ? (
            <span className="ms-2 text-xs text-fg-subtle">
              <bdi dir="ltr">{Math.round(e.percent)}%</bdi>
            </span>
          ) : null}
        </span>
      </div>
      <Meter
        label={t('settings.usage2', { label })}
        value={e.used}
        max={e.limit}
        warnAt={0.8}
        dangerAt={1}
      />
      <p className="text-xs text-fg-subtle">
        {e.basis === 'period' ? t('settings.countedThisMonth') : t('settings.heldRightNow')}
        {' · '}
        {e.enforced ? t('settings.enforced') : t('settings.reportedOnly')}
        {note ? <span className="text-fg-muted">{` · ${note}`}</span> : null}
      </p>
    </li>
  );
}
