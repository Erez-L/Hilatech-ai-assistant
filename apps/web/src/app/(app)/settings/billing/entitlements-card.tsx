'use client';

import { format } from 'date-fns';
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

const STATE_VARIANT = { ok: 'neutral', warning: 'warning', exceeded: 'danger' } as const;

export function EntitlementsCard() {
  const query = useEntitlements();
  return (
    <Card role="region" aria-labelledby="entitlements-title">
      <CardHeader>
        <CardTitle id="entitlements-title">Plan usage</CardTitle>
        <CardDescription>
          {query.data
            ? `Month: ${format(new Date(query.data.periodStart), 'd MMM')} – ${format(new Date(query.data.periodEnd), 'd MMM yyyy')}. Warning from 80%.`
            : 'What your plan includes and how much is used.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={query}
          compact
          errorTitle="Plan usage couldn’t be loaded"
          loading={
            <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading plan usage">
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
            <ul className="flex flex-col gap-5" aria-label="Entitlements">
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
  const note = entitlementStateNote(e);
  const fmt = (n: number) => formatEntitlementValue(e.unit, n);
  return (
    <li className="flex flex-col gap-2" data-testid={`entitlement-${e.key}`} data-state={e.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-2">
          <span className="text-fg-muted">{e.label}</span>
          {e.state !== 'ok' ? (
            <Badge variant={STATE_VARIANT[e.state]} dot>
              {ENTITLEMENT_STATE_LABEL[e.state]}
            </Badge>
          ) : null}
        </span>
        <span className="font-medium tabular">
          {fmt(e.used)}
          <span className="text-fg-subtle"> / {e.limit == null ? 'no limit' : fmt(e.limit)}</span>
          {e.percent != null ? (
            <span className="ml-2 text-xs text-fg-subtle">{Math.round(e.percent)}%</span>
          ) : null}
        </span>
      </div>
      <Meter label={`${e.label} usage`} value={e.used} max={e.limit} warnAt={0.8} dangerAt={1} />
      <p className="text-xs text-fg-subtle">
        {e.basis === 'period' ? 'Counted this month' : 'Held right now'}
        {' · '}
        {e.enforced ? 'Enforced' : 'Reported only'}
        {note ? <span className="text-fg-muted">{` · ${note}`}</span> : null}
      </p>
    </li>
  );
}
