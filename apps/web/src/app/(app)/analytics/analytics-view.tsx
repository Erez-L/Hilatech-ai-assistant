'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { Permission, type AnalyticsGranularity } from '@hilatech/contracts';
import {
  Button,
  FormField,
  Input,
  PageHeader,
  SegmentedControl,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@hilatech/ui';
import { PermissionGate } from '@/components/common/permission-gate';
import {
  GRANULARITY_OPTIONS,
  RANGE_PRESETS,
  customRange,
  formatRangeSummary,
  presetRange,
  toRangeParams,
  type RangePreset,
} from '@/lib/analytics';
import { AgentsTab } from './agents-tab';
import { AutomationTab } from './automation-tab';
import { BusinessTab } from './business-tab';
import { SalesTab } from './sales-tab';
import { UsageTab } from './usage-tab';
import type { ReportContext } from './report-parts';
import { useT, useFormat } from '@/i18n/provider';
import { msg } from '@/i18n/msg';

const TABS = [
  { value: 'business', label: msg('analytics.business') },
  { value: 'sales', label: msg('analytics.sales') },
  { value: 'agents', label: msg('analytics.agentPerformance') },
  { value: 'automation', label: msg('analytics.automation') },
  { value: 'usage', label: msg('analytics.usage') },
] as const;
type TabValue = (typeof TABS)[number]['value'];

function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

export function AnalyticsView() {
  return (
    <PermissionGate anyOf={[Permission.ANALYTICS_READ]}>
      <AnalyticsBody />
    </PermissionGate>
  );
}

function AnalyticsBody() {
  const t = useT();
  const fmt = useFormat();
  const [tab, setTab] = React.useState<TabValue>('business');
  const [preset, setPreset] = React.useState<RangePreset>('30d');
  const [granularity, setGranularity] = React.useState<AnalyticsGranularity>('day');
  const [range, setRange] = React.useState(() => presetRange(30));
  const [fromDate, setFromDate] = React.useState(() => isoDate(presetRange(30).from));
  // The exclusive `to` is the next midnight; the editable end date is its last included day.
  const [toDate, setToDate] = React.useState(() =>
    isoDate(new Date(Date.parse(presetRange(30).to) - 86_400_000).toISOString()),
  );
  const [customError, setCustomError] = React.useState<string | null>(null);

  const choosePreset = (next: RangePreset) => {
    setPreset(next);
    setCustomError(null);
    const days = RANGE_PRESETS.find((p) => p.value === next)?.days;
    if (days) {
      const r = presetRange(days);
      setRange(r);
      setFromDate(isoDate(r.from));
      setToDate(isoDate(new Date(Date.parse(r.to) - 86_400_000).toISOString()));
    }
  };

  const applyCustom = (event: React.FormEvent) => {
    event.preventDefault();
    const result = customRange(fromDate, toDate, t);
    if (!result.ok) {
      setCustomError(result.error);
      return;
    }
    setCustomError(null);
    setRange({ from: result.from, to: result.to });
  };

  const refresh = () => {
    if (preset === 'custom') return;
    choosePreset(preset);
  };

  const ctx: ReportContext = React.useMemo(
    () => ({ params: toRangeParams(range, granularity), granularity }),
    [range, granularity],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('analytics.analytics')}
        description={t('analytics.leadsSalesAgentsAutomationsAnd')}
      />

      <section
        aria-label={t('analytics.reportRange')}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('analytics.dateRange')}</span>
            <SegmentedControl
              aria-label={t('analytics.dateRange')}
              options={RANGE_PRESETS.map((p) => ({ value: p.value, label: t(p.label) }))}
              value={preset}
              onValueChange={choosePreset}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('analytics.groupBy')}</span>
            <SegmentedControl
              aria-label={t('analytics.granularity')}
              options={GRANULARITY_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }))}
              value={granularity}
              onValueChange={setGranularity}
            />
          </div>
          {preset !== 'custom' ? (
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<RefreshCw aria-hidden />}
              onClick={refresh}
              aria-label={t('analytics.refreshReports')}
            >
              {t('common.refresh')}
            </Button>
          ) : null}
        </div>

        {preset === 'custom' ? (
          <form
            onSubmit={applyCustom}
            noValidate
            aria-label={t('analytics.customDateRange')}
            className="flex flex-wrap items-start gap-3"
          >
            <FormField id="analytics-from" label={t('analytics.fromDate')}>
              <Input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-44"
              />
            </FormField>
            <FormField id="analytics-to" label={t('analytics.toDate')} error={customError}>
              <Input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="w-44"
              />
            </FormField>
            <Button type="submit" variant="secondary" className="mt-[1.625rem]">
              {t('analytics.applyRange')}
            </Button>
          </form>
        ) : null}

        <p className="text-xs text-fg-muted" data-testid="analytics-range-summary">
          {t('analytics.showingGroupedByDatesAnd', {
            formatRangeSummary: formatRangeSummary(range, fmt),
            granularity: t(`analytics.granularity.${granularity}`).toLowerCase(),
          })}
        </p>
      </section>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <div className="overflow-x-auto scrollbar-thin">
          <TabsList aria-label={t('analytics.analyticsReports')} className="min-w-max">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {t(tab.label)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="business">
          <BusinessTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="sales">
          <SalesTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="agents">
          <AgentsTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="automation">
          <AutomationTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="usage">
          <UsageTab ctx={ctx} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
