'use client';

import * as React from 'react';
import { ArrowUpRight, CreditCard, Mail } from 'lucide-react';
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
  toast,
} from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useCheckout, useUpgradeOptions } from '@/hooks/billing';
import { useCan } from '@/hooks/use-can';
import { QueryState } from '@/components/common/query-state';
import { PLAN_LIMIT_ROWS, formatLimit } from '@/lib/billing';
import { humanizeValue } from '@/i18n/enums';
import { msg, tm, type Msg } from '@/i18n/msg';
import { useT, useFormat } from '@/i18n/provider';

const ENTITLEMENT_NAMES: Record<string, Msg> = {
  seats: msg('billing.noun.seats'),
  ai_tokens: msg('billing.noun.ai_tokens'),
  documents: msg('billing.noun.documents'),
  storage_mb: msg('billing.noun.storage_mb'),
  agents: msg('billing.noun.agents'),
  automations: msg('billing.noun.automations'),
  agent_executions: msg('billing.noun.agent_executions'),
  automation_runs: msg('billing.noun.automation_runs'),
};

export function UpgradeCard() {
  const t = useT();
  const fmt = useFormat();
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
      toast.success(t('settings.checkoutStarted'));
    } catch (error) {
      if (
        isApiError(error) &&
        (error.status === 501 || error.code === ErrorCode.PAYMENT_NOT_CONFIGURED)
      ) {
        setNotConfigured({ plan: option.plan.name, message: error.message });
      } else {
        toast.error(getErrorMessage(error, t('settings.checkoutCouldNotStart')));
      }
    } finally {
      setPending(null);
    }
  };

  return (
    <Card id="upgrade" role="region" aria-labelledby="upgrade-title">
      <CardHeader>
        <CardTitle id="upgrade-title">{t('settings.upgradeOptions')}</CardTitle>
        <CardDescription>{t('settings.higherPlansWhatTheyAdd')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {notConfigured ? (
          <Alert
            tone="warning"
            title={t('settings.paymentIsNotConfigured')}
            data-testid="payment-not-configured"
          >
            {t('settings.checkoutUnavailable', { plan: notConfigured.plan })}
            {notConfigured.message ? ` (${notConfigured.message})` : ''}
          </Alert>
        ) : null}
        <QueryState
          query={query}
          compact
          errorTitle={t('settings.upgradeOptionsCouldnTBe')}
          loading={<Skeleton className="h-32 w-full" />}
        >
          {(data) => (
            <>
              <Alert tone="neutral" title={t('settings.paymentsAreNotSwitchedOn')}>
                {t('settings.plansAreChangedThroughSales')}
              </Alert>
              {data.pressure.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">{t('settings.needsAttention')}</p>
                  <ul
                    className="flex flex-wrap gap-2"
                    aria-label={t('settings.entitlementsUnderPressure')}
                  >
                    {data.pressure.map((p) => (
                      <li key={p.key}>
                        <Badge variant={p.state === 'exceeded' ? 'danger' : 'warning'} dot>
                          {p.label}:{' '}
                          {p.state === 'exceeded'
                            ? t('settings.limitReached')
                            : t('settings.nearingLimit')}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {data.options.length === 0 ? (
                <p className="text-sm text-fg-muted">{t('settings.youAreOnTheHighest')}</p>
              ) : (
                <ul
                  className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
                  aria-label={t('settings.higherPlans')}
                >
                  {data.options.map((option) => {
                    return (
                      <li
                        key={option.plan.key}
                        data-testid={`upgrade-${option.plan.key}`}
                        className="flex flex-col gap-3 rounded-lg border border-border p-4"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="text-base font-semibold">{option.plan.name}</h3>
                          <span className="text-xs text-fg-muted">
                            {t('settings.pricingNotConfigured')}
                          </span>
                        </div>
                        {/* What the plan includes in total — clearer than a difference such as "+924 MB". */}
                        <dl className="flex flex-col gap-1 text-sm">
                          {PLAN_LIMIT_ROWS.map((row) => (
                            <div
                              key={row.key}
                              className="flex items-baseline justify-between gap-3"
                            >
                              <dt className="text-fg-muted">{tm(t, row.label)}</dt>
                              <dd className="font-medium tabular">
                                <bdi dir="ltr">
                                  {formatLimit(row, option.plan.limits[row.key], fmt)}
                                </bdi>
                              </dd>
                            </div>
                          ))}
                        </dl>
                        {option.resolves.length > 0 ? (
                          <p className="text-xs text-success-soft-fg">
                            {t('settings.resolves')}{' '}
                            {option.resolves
                              .map((k) => tm(t, ENTITLEMENT_NAMES[k] ?? humanizeValue(k)))
                              .join(', ')}
                          </p>
                        ) : null}
                        {data.payment.configured ? (
                          <Button
                            className="mt-auto"
                            variant={option.resolves.length > 0 ? 'primary' : 'secondary'}
                            leadingIcon={<CreditCard aria-hidden />}
                            trailingIcon={<ArrowUpRight aria-hidden />}
                            loading={pending === option.plan.key}
                            disabled={!canManage || pending !== null}
                            title={
                              canManage ? undefined : t('settings.requiresTheBillingPermission')
                            }
                            aria-label={t('settings.upgradeTo', { name: option.plan.name })}
                            onClick={() => void upgrade(option)}
                          >
                            {t('settings.upgrade')}
                          </Button>
                        ) : (
                          // No payment provider: a plan cannot be bought here, so the action is to talk to sales.
                          <Button
                            asChild
                            className="mt-auto"
                            variant={option.resolves.length > 0 ? 'primary' : 'secondary'}
                            leadingIcon={<Mail aria-hidden />}
                          >
                            <a
                              href={`mailto:sales@hilatech.dev?subject=${encodeURIComponent(
                                `HilaTech AI Assistant: ${option.plan.name} plan`,
                              )}`}
                              aria-label={t('settings.contactSalesAbout', {
                                name: option.plan.name,
                              })}
                            >
                              {t('settings.contactSales')}
                            </a>
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {!canManage ? (
                <p className="text-xs text-fg-muted">{t('settings.onlyMembersWithTheBilling')}</p>
              ) : null}
            </>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
