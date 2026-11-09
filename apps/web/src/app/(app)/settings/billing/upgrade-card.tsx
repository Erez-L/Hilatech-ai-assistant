'use client';

import * as React from 'react';
import { ArrowUpRight, CreditCard } from 'lucide-react';
import { ErrorCode, Permission, type UpgradeOption } from '@hilatech/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  humanize,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useCheckout, useUpgradeOptions } from '@/hooks/billing';
import { useCan } from '@/hooks/use-can';
import { QueryState } from '@/components/common/query-state';
import { describeLimitDelta } from '@/lib/billing';

const ENTITLEMENT_NAMES: Record<string, string> = {
  seats: 'seats',
  ai_tokens: 'AI tokens',
  documents: 'documents',
  storage_mb: 'storage',
  agents: 'agents',
  automations: 'automations',
  agent_executions: 'agent runs',
  automation_runs: 'automation runs',
};

export function UpgradeCard() {
  const query = useUpgradeOptions();
  const canManage = useCan(Permission.ORG_BILLING_MANAGE);
  const checkout = useCheckout();
  const [pending, setPending] = React.useState<string | null>(null);
  const [notConfigured, setNotConfigured] = React.useState<{
    plan: string;
    message: string;
  } | null>(null);

  const upgrade = async (option: UpgradeOption) => {
    setPending(option.plan.key);
    setNotConfigured(null);
    try {
      await checkout.mutateAsync(option.plan.key);
      toast.success('Checkout started');
    } catch (error) {
      if (
        isApiError(error) &&
        (error.status === 501 || error.code === ErrorCode.PAYMENT_NOT_CONFIGURED)
      ) {
        setNotConfigured({ plan: option.plan.name, message: error.message });
      } else {
        toast.error(getErrorMessage(error, 'Checkout could not be started.'));
      }
    } finally {
      setPending(null);
    }
  };

  return (
    <Card id="upgrade" role="region" aria-labelledby="upgrade-title">
      <CardHeader>
        <CardTitle id="upgrade-title">Upgrade options</CardTitle>
        <CardDescription>
          Higher plans, what they add compared with your current plan, and which pressure they
          resolve.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {notConfigured ? (
          <Alert
            tone="warning"
            title="Payment is not configured"
            data-testid="payment-not-configured"
          >
            Checkout for {notConfigured.plan} is unavailable: no payment provider is connected to
            this deployment. No charge was made and your plan has not changed.
            {notConfigured.message ? ` (${notConfigured.message})` : ''}
          </Alert>
        ) : null}
        <QueryState
          query={query}
          compact
          errorTitle="Upgrade options couldn’t be loaded"
          loading={<Skeleton className="h-32 w-full" />}
        >
          {(data) => (
            <>
              <Alert tone="neutral" title="Payments are not switched on yet">
                {data.payment.message}
              </Alert>
              {data.pressure.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Needs attention</p>
                  <ul className="flex flex-wrap gap-2" aria-label="Entitlements under pressure">
                    {data.pressure.map((p) => (
                      <li key={p.key}>
                        <Badge variant={p.state === 'exceeded' ? 'danger' : 'warning'} dot>
                          {p.label}: {p.state === 'exceeded' ? 'limit reached' : 'nearing limit'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {data.options.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  You are on the highest self-service plan. Contact sales for custom limits.
                </p>
              ) : (
                <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Higher plans">
                  {data.options.map((option) => {
                    const deltas = Object.entries(option.limitDeltas)
                      .map(([k, v]) => describeLimitDelta(k, v))
                      .filter((x): x is string => !!x);
                    return (
                      <li
                        key={option.plan.key}
                        data-testid={`upgrade-${option.plan.key}`}
                        className="flex flex-col gap-3 rounded-lg border border-border p-4"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="text-base font-semibold">{option.plan.name}</h3>
                          <span className="text-xs text-fg-muted">Pricing not configured</span>
                        </div>
                        <ul className="flex flex-col gap-1 text-sm text-fg-muted">
                          {deltas.length === 0 ? <li>Same limits as today</li> : null}
                          {deltas.map((d) => (
                            <li key={d} className="tabular">
                              {d}
                            </li>
                          ))}
                        </ul>
                        {option.resolves.length > 0 ? (
                          <p className="text-xs text-success-soft-fg">
                            Resolves:{' '}
                            {option.resolves
                              .map((k) => ENTITLEMENT_NAMES[k] ?? humanize(k))
                              .join(', ')}
                          </p>
                        ) : null}
                        <Button
                          className="mt-auto"
                          variant={option.resolves.length > 0 ? 'primary' : 'secondary'}
                          leadingIcon={<CreditCard aria-hidden />}
                          trailingIcon={<ArrowUpRight aria-hidden />}
                          loading={pending === option.plan.key}
                          disabled={!canManage || pending !== null}
                          title={canManage ? undefined : 'Requires the billing permission'}
                          aria-label={`Upgrade to ${option.plan.name}`}
                          onClick={() => void upgrade(option)}
                        >
                          Upgrade
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!canManage ? (
                <p className="text-xs text-fg-muted">
                  Only members with the billing permission can start an upgrade.
                </p>
              ) : null}
            </>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
