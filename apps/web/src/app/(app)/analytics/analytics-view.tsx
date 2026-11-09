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

const TABS = [
  { value: 'business', label: 'Business' },
  { value: 'sales', label: 'Sales' },
  { value: 'agents', label: 'Agent performance' },
  { value: 'automation', label: 'Automation' },
  { value: 'usage', label: 'Usage' },
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
    const result = customRange(fromDate, toDate);
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
        title="Analytics"
        description="Leads, sales, agents, automations and AI usage for this organization, computed from live data."
      />

      <section
        aria-label="Report range"
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Date range</span>
            <SegmentedControl
              aria-label="Date range"
              options={RANGE_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
              value={preset}
              onValueChange={choosePreset}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Group by</span>
            <SegmentedControl
              aria-label="Granularity"
              options={GRANULARITY_OPTIONS}
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
              aria-label="Refresh reports"
            >
              Refresh
            </Button>
          ) : null}
        </div>

        {preset === 'custom' ? (
          <form
            onSubmit={applyCustom}
            noValidate
            aria-label="Custom date range"
            className="flex flex-wrap items-start gap-3"
          >
            <FormField id="analytics-from" label="From date">
              <Input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-44"
              />
            </FormField>
            <FormField id="analytics-to" label="To date" error={customError}>
              <Input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="w-44"
              />
            </FormField>
            <Button type="submit" variant="secondary" className="mt-[1.625rem]">
              Apply range
            </Button>
          </form>
        ) : null}

        <p className="text-xs text-fg-muted" data-testid="analytics-range-summary">
          Showing {formatRangeSummary(range)}, grouped by {granularity}. Dates and buckets use UTC.
        </p>
      </section>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <div className="overflow-x-auto scrollbar-thin">
          <TabsList aria-label="Analytics reports" className="min-w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
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
