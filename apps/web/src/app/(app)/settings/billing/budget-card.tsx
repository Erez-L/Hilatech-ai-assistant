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
  formatCompact,
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

const LEVEL_VARIANT = { ok: 'neutral', warning: 'warning', exceeded: 'danger' } as const;
const LEVEL_LABEL = { ok: 'OK', warning: 'Warning', exceeded: 'Exceeded' } as const;

export function BudgetCard() {
  const query = useBudget();
  return (
    <Card role="region" aria-labelledby="budget-title">
      <CardHeader>
        <CardTitle id="budget-title">AI budget</CardTitle>
        <CardDescription>
          Cap monthly AI spend. With the hard stop on, the assistant and agents stop answering once
          a budget is used up.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={query}
          compact
          errorTitle="The budget couldn’t be loaded"
          loading={<Skeleton className="h-48 w-full" />}
        >
          {(status) => <BudgetBody status={status} />}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function BudgetBody({ status }: { status: BudgetStatus }) {
  return (
    <div className="flex flex-col gap-6">
      {status.blocked ? (
        <Alert tone="danger" title="AI requests are blocked" data-testid="budget-blocked">
          A budget is used up and the hard stop is on, so the assistant and agents are refusing new
          requests until the budget is raised, the hard stop is turned off, or next month begins.
        </Alert>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <BudgetMeter
          title="Tokens this month"
          level={status.tokens.level}
          used={status.tokens.used}
          budget={status.tokens.budget}
          format={formatCompact}
          meterLabel="Token budget used this month"
          emptyText="No token budget set"
        />
        <BudgetMeter
          title="Cost this month"
          level={status.cost.level}
          used={status.cost.usedUsd}
          budget={status.cost.budgetUsd}
          format={(n) => formatUsd(n)}
          meterLabel="Cost budget used this month"
          emptyText="No cost budget set"
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 text-fg-muted">
          {title}
          {level !== 'ok' ? (
            <Badge variant={LEVEL_VARIANT[level]} dot>
              {LEVEL_LABEL[level]}
            </Badge>
          ) : null}
        </span>
        <span className="font-medium tabular">
          {budget == null ? (
            <span className="text-fg-subtle">{emptyText}</span>
          ) : unavailable || used == null ? (
            <span className="text-fg-subtle">Budget {format(budget)} · usage not measurable</span>
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
    const parsed = parseBudgetForm(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(parsed.body);
      setSaved(true);
      toast.success('Budget saved');
    } catch (error) {
      setFormError(getErrorMessage(error, 'The budget could not be saved.'));
    }
  };

  const costNeedsPricing = !status.cost.enforceable;

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Budget settings"
      className="flex flex-col gap-5 border-t border-border pt-5"
    >
      {!canManage ? (
        <Alert tone="neutral" title="Read only">
          Changing the budget requires the billing permission.
        </Alert>
      ) : null}
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <FormField
          id="budget-token"
          label="Monthly token budget"
          description="Input + output tokens. Leave empty for no token budget."
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
          label="Monthly cost budget (USD)"
          description={
            costNeedsPricing
              ? 'Requires pricing configuration: without model prices the cost cannot be measured or enforced.'
              : 'Leave empty for no cost budget.'
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
          label="Warn at (%)"
          description="Raise an alert when a budget reaches this share."
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
          Cost budget: requires pricing configuration.{' '}
          {status.cost.note ?? 'No model pricing is configured for this deployment.'}
        </p>
      ) : status.cost.note ? (
        <p className="text-xs text-fg-muted" data-testid="cost-budget-note">
          {status.cost.note}
        </p>
      ) : null}

      <FormField
        id="budget-hard-stop"
        inline
        label="Hard stop: refuse AI requests once a budget is used up"
        description="Off by default. When on, requests that would pass the budget are refused with a clear message before any model is called."
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
          Save budget
        </Button>
        {saved ? (
          <span role="status" className="text-sm text-success-soft-fg">
            Budget saved.
          </span>
        ) : null}
      </div>
    </form>
  );
}
