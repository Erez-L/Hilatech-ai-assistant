'use client';

import * as React from 'react';
import { Permission, type BudgetStatus } from '@hilatech/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Meter,
  Skeleton,
  Switch,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useBudget, useUpdateBudget } from '@/hooks/billing';
import { useCan } from '@/hooks/use-can';
import { QueryState } from '@/components/common/query-state';
import { formatUsd } from '@/lib/analytics';
import {
  budgetToFormValues,
  parseBudgetForm,
  type BudgetFormErrors,
  type BudgetFormValues,
} from '@/lib/billing';
import { useT, useFormat } from '@/i18n/provider';
import { msg } from '@/i18n/msg';

const LEVEL_VARIANT = { ok: 'neutral', warning: 'warning', exceeded: 'danger' } as const;
const LEVEL_LABEL = {
  ok: msg('billing.levelOk'),
  warning: msg('billing.levelWarning'),
  exceeded: msg('billing.levelExceeded'),
} as const;

export function BudgetCard() {
  const t = useT();
  const query = useBudget();
  return (
    <Card role="region" aria-labelledby="budget-title">
      <CardHeader>
        <CardTitle id="budget-title">{t('settings.aiBudget')}</CardTitle>
        <CardDescription>{t('settings.capMonthlyAiSpendWith')}</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={query}
          compact
          errorTitle={t('settings.theBudgetCouldnTBe')}
          loading={<Skeleton className="h-48 w-full" />}
        >
          {(status) => <BudgetBody status={status} />}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function BudgetBody({ status }: { status: BudgetStatus }) {
  const fmt = useFormat();
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      {status.blocked ? (
        <Alert
          tone="danger"
          title={t('settings.aiRequestsAreBlocked')}
          data-testid="budget-blocked"
        >
          {t('settings.aBudgetIsUsedUp')}
        </Alert>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <BudgetMeter
          title={t('settings.tokensThisMonth')}
          level={status.tokens.level}
          used={status.tokens.used}
          budget={status.tokens.budget}
          format={fmt.compact}
          meterLabel={t('common.tokenBudgetUsedThisMonth')}
          emptyText={t('settings.noTokenBudgetSet')}
        />
        <BudgetMeter
          title={t('settings.costThisMonth')}
          level={status.cost.level}
          used={status.cost.usedUsd}
          budget={status.cost.budgetUsd}
          format={(n) => formatUsd(n, fmt)}
          meterLabel={t('settings.costBudgetUsedThisMonth')}
          emptyText={t('settings.noCostBudgetSet')}
          unavailable={!status.cost.enforceable}
        />
      </div>

      <BudgetForm status={status} />
    </div>
  );
}

function BudgetMeter({
  title,
  level,
  used,
  budget,
  format,
  meterLabel,
  emptyText,
  unavailable,
}: {
  title: string;
  level: 'ok' | 'warning' | 'exceeded';
  used: number | null;
  budget: number | null;
  format: (n: number) => string;
  meterLabel: string;
  emptyText: string;
  unavailable?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 text-fg-muted">
          {title}
          {level !== 'ok' ? (
            <Badge variant={LEVEL_VARIANT[level]} dot>
              {t(LEVEL_LABEL[level])}
            </Badge>
          ) : null}
        </span>
        <span className="font-medium tabular">
          {budget == null ? (
            <span className="text-fg-subtle">{emptyText}</span>
          ) : unavailable || used == null ? (
            <span className="text-fg-subtle">
              {t('settings.budgetUsageNotMeasurable', { format: format(budget) })}
            </span>
          ) : (
            <>
              {format(used)}
              <span className="text-fg-subtle"> / {format(budget)}</span>
            </>
          )}
        </span>
      </div>
      <Meter
        label={meterLabel}
        value={used ?? 0}
        max={unavailable ? null : budget}
        warnAt={0.8}
        dangerAt={1}
      />
    </div>
  );
}

function BudgetForm({ status }: { status: BudgetStatus }) {
  const t = useT();
  const canManage = useCan(Permission.ORG_BILLING_MANAGE);
  const update = useUpdateBudget();
  const [values, setValues] = React.useState<BudgetFormValues>(() => budgetToFormValues(status));
  const [errors, setErrors] = React.useState<BudgetFormErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  // Re-sync with the server after a save (or when another admin changes the budget).
  const [syncedAt, setSyncedAt] = React.useState(status.settings.updatedAt);
  if (syncedAt !== status.settings.updatedAt) {
    setSyncedAt(status.settings.updatedAt);
    setValues(budgetToFormValues(status));
  }

  const set = <K extends keyof BudgetFormValues>(key: K, value: BudgetFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setSaved(false);
    const parsed = parseBudgetForm(values, t);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(parsed.body);
      setSaved(true);
      toast.success(t('settings.budgetSaved'));
    } catch (error) {
      setFormError(getErrorMessage(error, t('settings.budgetCouldNotSave')));
    }
  };

  const costNeedsPricing = !status.cost.enforceable;

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t('settings.budgetSettings')}
      className="flex flex-col gap-5 border-t border-border pt-5"
    >
      {!canManage ? (
        <Alert tone="neutral" title={t('settings.readOnly')}>
          {t('settings.changingTheBudgetRequiresThe')}
        </Alert>
      ) : null}
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <FormField
          id="budget-token"
          label={t('settings.monthlyTokenBudget')}
          description={t('settings.inputOutputTokensLeaveEmpty')}
          error={errors.monthlyTokenBudget}
        >
          <Input
            inputMode="numeric"
            placeholder="e.g. 50000"
            value={values.monthlyTokenBudget}
            disabled={!canManage}
            onChange={(e) => set('monthlyTokenBudget', e.target.value)}
          />
        </FormField>
        <FormField
          id="budget-cost"
          label={t('settings.monthlyCostBudgetUsd')}
          description={
            costNeedsPricing
              ? t('settings.requiresPricingConfigurationWithoutModel')
              : t('settings.leaveEmptyForNoCost')
          }
          error={errors.monthlyCostBudgetUsd}
        >
          <Input
            inputMode="decimal"
            placeholder="e.g. 25"
            value={values.monthlyCostBudgetUsd}
            disabled={!canManage}
            onChange={(e) => set('monthlyCostBudgetUsd', e.target.value)}
          />
        </FormField>
        <FormField
          id="budget-warn"
          label={t('settings.warnAt')}
          description={t('settings.raiseAnAlertWhenA')}
          error={errors.warnThresholdPct}
        >
          <Input
            inputMode="numeric"
            value={values.warnThresholdPct}
            disabled={!canManage}
            onChange={(e) => set('warnThresholdPct', e.target.value)}
          />
        </FormField>
      </div>

      {costNeedsPricing ? (
        <p className="text-xs text-fg-muted" data-testid="cost-budget-requires-pricing">
          {t('settings.costBudgetRequiresPricingConfiguration')}{' '}
          {status.cost.note ?? t('settings.noModelPricingIsConfigured')}
        </p>
      ) : status.cost.note ? (
        <p className="text-xs text-fg-muted" data-testid="cost-budget-note">
          {status.cost.note}
        </p>
      ) : null}

      <FormField
        id="budget-hard-stop"
        inline
        label={t('settings.hardStopRefuseAiRequests')}
        description={t('settings.offByDefaultWhenOn')}
        error={errors.hardStopEnabled}
      >
        <Switch
          checked={values.hardStopEnabled}
          disabled={!canManage}
          onCheckedChange={(checked) => set('hardStopEnabled', checked)}
        />
      </FormField>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={update.isPending} disabled={!canManage}>
          {t('settings.saveBudget')}
        </Button>
        {saved ? (
          <span role="status" className="text-sm text-success-soft-fg">
            {t('settings.budgetSaved2')}
          </span>
        ) : null}
      </div>
    </form>
  );
}
