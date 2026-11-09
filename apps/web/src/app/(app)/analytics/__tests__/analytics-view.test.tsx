import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, seedSession } from '@/test/render';
import { json, mockApi } from '@/test/fetch';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/analytics',
  useSearchParams: () => new URLSearchParams(),
}));

import { AnalyticsView } from '../analytics-view';

const RANGE = {
  from: '2026-10-10T00:00:00.000Z',
  to: '2026-11-10T00:00:00.000Z',
  granularity: 'day',
  buckets: 2,
};
const POINTS = [
  { bucket: '2026-11-08T00:00:00.000Z', count: 1 },
  { bucket: '2026-11-09T00:00:00.000Z', count: 2 },
];
const ZERO = [
  { bucket: '2026-11-08T00:00:00.000Z', count: 0 },
  { bucket: '2026-11-09T00:00:00.000Z', count: 0 },
];

const budget = (over: Record<string, unknown> = {}) => ({
  settings: {
    monthlyTokenBudget: 1000,
    monthlyCostBudgetUsd: null,
    warnThresholdPct: 80,
    hardStopEnabled: false,
    updatedAt: null,
    updatedById: null,
  },
  periodStart: '2026-11-01T00:00:00.000Z',
  periodEnd: '2026-12-01T00:00:00.000Z',
  tokens: { used: 300, budget: 1000, percent: 30, level: 'ok' },
  cost: {
    usedUsd: null,
    budgetUsd: null,
    percent: null,
    level: 'ok',
    enforceable: false,
    pricedRequests: 0,
    unpricedRequests: 2,
    note: null,
  },
  blocked: false,
  ...over,
});

function business(over: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-11-09T10:00:00.000Z',
    range: RANGE,
    contacts: { created: 3, series: POINTS },
    leads: {
      created: 3,
      byStatus: { new: 2, won: 1 },
      bySource: { website: 3 },
      series: POINTS,
    },
    funnel: {
      basis: 'current_status_of_leads_created_in_range',
      stages: [
        { status: 'new', reached: 3, rateFromPrevious: null, rateFromTop: 1 },
        { status: 'won', reached: 1, rateFromPrevious: 0.3333, rateFromTop: 0.3333 },
      ],
      lost: 0,
      conversionRate: 0.3333,
    },
    conversations: { created: 3, byStatus: { open: 3 }, byChannel: { web: 3 }, series: POINTS },
    tasks: { modelled: false, reason: 'There is no Task model yet.' },
    ...over,
  };
}

function stubObjectUrls(created: string[] = []) {
  Object.assign(URL, {
    createObjectURL: () => {
      created.push('blob');
      return 'blob:test';
    },
    revokeObjectURL: vi.fn(),
  });
}

describe('AnalyticsView', () => {
  beforeEach(() => seedSession(['analytics:read', 'organization:billing:manage']));
  afterEach(() => vi.unstubAllGlobals());

  it('is blocked without the analytics permission', () => {
    seedSession([]);
    mockApi({});
    renderWithProviders(<AnalyticsView />);
    expect(screen.getByText('You don’t have access to this page')).toBeInTheDocument();
  });

  it('loads the business report with the date range and granularity, and notes tasks are not modelled', async () => {
    const { calls } = mockApi({ 'GET /analytics/business': () => business() });
    renderWithProviders(<AnalyticsView />);
    expect(await screen.findByText('Leads created')).toBeInTheDocument();
    const first = calls.find((c) => c.path === '/analytics/business')!;
    const url = new URL(first.url);
    expect(url.searchParams.get('granularity')).toBe('day');
    expect(url.searchParams.get('from')).toMatch(/T00:00:00\.000Z$/);
    expect(url.searchParams.get('to')).toMatch(/T00:00:00\.000Z$/);

    expect(screen.getByTestId('tasks-not-modelled')).toHaveTextContent(
      'There is no Task model yet.',
    );
    expect(screen.getByRole('table', { name: 'Lead funnel' })).toBeInTheDocument();
    expect(screen.getByText(/no stage history/i)).toBeInTheDocument();

    // Changing granularity refetches with the new value.
    await userEvent.click(screen.getByRole('radio', { name: 'Week' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === '/analytics/business' &&
            new URL(c.url).searchParams.get('granularity') === 'week',
        ),
      ).toBe(true),
    );
  });

  it('validates a custom range before querying', async () => {
    const { calls } = mockApi({ 'GET /analytics/business': () => business() });
    renderWithProviders(<AnalyticsView />);
    await screen.findByText('Leads created');
    await userEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    const from = screen.getByLabelText('From date');
    const to = screen.getByLabelText('To date');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-11-05');
    await userEvent.clear(to);
    await userEvent.type(to, '2026-11-05');
    const before = calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Apply range' }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    const last = calls.filter((c) => c.path === '/analytics/business').at(-1)!;
    expect(new URL(last.url).searchParams.get('from')).toBe('2026-11-05T00:00:00.000Z');
    expect(new URL(last.url).searchParams.get('to')).toBe('2026-11-06T00:00:00.000Z');
  });

  it('shows an empty state when nothing happened in the range', async () => {
    mockApi({
      'GET /analytics/business': () =>
        business({
          contacts: { created: 0, series: ZERO },
          leads: { created: 0, byStatus: {}, bySource: {}, series: ZERO },
          conversations: { created: 0, byStatus: {}, byChannel: {}, series: ZERO },
          funnel: {
            basis: 'current_status_of_leads_created_in_range',
            stages: [],
            lost: 0,
            conversionRate: null,
          },
        }),
    });
    renderWithProviders(<AnalyticsView />);
    expect(await screen.findByText('No activity in this range')).toBeInTheDocument();
  });

  it('shows an error with a retry when the report fails', async () => {
    let fail = true;
    mockApi({
      'GET /analytics/business': () =>
        fail ? json({ error: { code: 'INTERNAL_ERROR', message: 'Boom' } }, 500) : business(),
    });
    renderWithProviders(<AnalyticsView />);
    expect(await screen.findByText('Business analytics couldn’t be loaded')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Leads created')).toBeInTheDocument();
  });

  it('explains that sales are derived from leads', async () => {
    mockApi({
      'GET /analytics/business': () => business(),
      'GET /analytics/sales': () => ({
        generatedAt: '2026-11-09T10:00:00.000Z',
        range: RANGE,
        dealsModelled: false,
        basis: 'leads_with_value',
        closeDateBasis: 'convertedAt_or_updatedAt',
        pipeline: [{ status: 'new', currency: 'USD', count: 2, value: 1500 }],
        closedInRange: [
          {
            currency: 'USD',
            wonCount: 1,
            wonValue: 900,
            lostCount: 1,
            lostValue: 100,
            avgWonValue: 900,
          },
        ],
        winRate: 0.5,
        avgSalesCycleDays: 4,
        bySource: [{ source: 'website', won: 1, lost: 1, winRate: 0.5 }],
        wonSeries: POINTS,
      }),
    });
    renderWithProviders(<AnalyticsView />);
    await screen.findByText('Leads created');
    await userEvent.click(screen.getByRole('tab', { name: 'Sales' }));
    expect(await screen.findByTestId('deals-not-modelled')).toHaveTextContent('derived from leads');
    expect((await screen.findAllByText('50%')).length).toBeGreaterThan(0);
    const pipeline = screen.getByRole('table', { name: 'Open pipeline' });
    expect(within(pipeline).getByText('$1,500')).toBeInTheDocument();
  });

  it('says costs are unavailable when no pricing is configured (agents)', async () => {
    mockApi({
      'GET /analytics/business': () => business(),
      'GET /analytics/agents': () => ({
        generatedAt: '2026-11-09T10:00:00.000Z',
        range: RANGE,
        pricingConfigured: false,
        totals: {
          executions: 2,
          succeeded: 1,
          failed: 1,
          successRate: 0.5,
          byStatus: { succeeded: 1, failed: 1 },
          durationMs: { avg: 1200, p50: 1000, p95: 2000 },
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          costUsd: null,
          costCoverage: { priced: 0, total: 2 },
        },
        byAgent: [
          {
            agentId: '66666666-6666-4666-8666-666666666666',
            name: 'Triage',
            executions: 2,
            succeeded: 1,
            failed: 1,
            successRate: 0.5,
            durationMs: { avg: 1200, p50: 1000, p95: 2000 },
            totalTokens: 150,
            costUsd: null,
          },
        ],
        series: [{ bucket: '2026-11-09T00:00:00.000Z', total: 2, succeeded: 1, failed: 1 }],
      }),
    });
    renderWithProviders(<AnalyticsView />);
    await screen.findByText('Leads created');
    await userEvent.click(screen.getByRole('tab', { name: 'Agent performance' }));
    expect(await screen.findByTestId('agents-cost-note')).toHaveTextContent(
      'No model pricing is configured',
    );
    expect(screen.getByRole('table', { name: 'Agent performance by agent' })).toHaveTextContent(
      'Triage',
    );
  });

  it('renders usage, honest cost notes and downloads CSV exports through the API', async () => {
    const created: string[] = [];
    const click = vi.fn();
    stubObjectUrls(created);
    const anchor = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = click;
    const { calls } = mockApi({
      'GET /analytics/business': () => business(),
      'GET /analytics/export': () =>
        new Response('bucket,requests\n2026-11-09,2\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="usage-series.csv"',
          },
        }),
      'GET /analytics/usage': () => ({
        generatedAt: '2026-11-09T10:00:00.000Z',
        range: RANGE,
        pricingConfigured: false,
        totals: {
          requests: 2,
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          costUsd: null,
          successRequests: 2,
          errorRequests: 0,
          pricedRequests: 0,
        },
        byModel: [
          {
            provider: 'mock',
            model: 'mock-chat',
            requests: 2,
            inputTokens: 200,
            outputTokens: 100,
            totalTokens: 300,
            costUsd: null,
          },
        ],
        byAgent: [
          {
            agentId: null,
            name: null,
            requests: 2,
            inputTokens: 200,
            outputTokens: 100,
            totalTokens: 300,
            costUsd: null,
          },
        ],
        byUser: [],
        series: [
          {
            bucket: '2026-11-09T00:00:00.000Z',
            requests: 2,
            inputTokens: 200,
            outputTokens: 100,
            totalTokens: 300,
            costUsd: null,
          },
        ],
        currentPeriod: {
          periodStart: '2026-11-01T00:00:00.000Z',
          periodEnd: '2026-12-01T00:00:00.000Z',
          planTokenLimit: 100000,
          tokensUsed: 300,
          percentOfPlan: 0.3,
          budget: budget({
            settings: { ...budget().settings, monthlyCostBudgetUsd: 5 },
            cost: { ...budget().cost, budgetUsd: 5 },
          }),
        },
      }),
    });
    try {
      renderWithProviders(<AnalyticsView />);
      await screen.findByText('Leads created');
      await userEvent.click(screen.getByRole('tab', { name: 'Usage' }));
      expect(await screen.findByTestId('usage-cost-note')).toHaveTextContent('No model pricing');
      expect(screen.getByTestId('usage-cost-budget-note')).toHaveTextContent(
        'cannot be measured or enforced',
      );
      expect(
        screen.getByRole('meter', { name: 'Token budget used this month' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'Usage by agent' })).toHaveTextContent(
        'Assistant & other calls',
      );

      await userEvent.click(
        screen.getByRole('button', { name: 'Export usage time series as CSV' }),
      );
      await waitFor(() => expect(click).toHaveBeenCalled());
      const req = calls.find((c) => c.path === '/analytics/export')!;
      const q = new URL(req.url).searchParams;
      expect(q.get('report')).toBe('usage');
      expect(q.get('section')).toBe('series');
      expect(q.get('granularity')).toBe('day');
      expect(created).toHaveLength(1);
    } finally {
      HTMLAnchorElement.prototype.click = anchor;
    }
  });

  it('exports the business report', async () => {
    const click = vi.fn();
    const anchor = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = click;
    stubObjectUrls();
    const { calls } = mockApi({
      'GET /analytics/business': () => business(),
      'GET /analytics/export': () =>
        new Response('a,b\n', { status: 200, headers: { 'Content-Type': 'text/csv' } }),
    });
    try {
      renderWithProviders(<AnalyticsView />);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Export business breakdown as CSV' }),
      );
      await waitFor(() => expect(click).toHaveBeenCalled());
      const q = new URL(calls.find((c) => c.path === '/analytics/export')!.url).searchParams;
      expect(q.get('report')).toBe('business');
      expect(q.get('section')).toBe('breakdown');
    } finally {
      HTMLAnchorElement.prototype.click = anchor;
    }
  });
});
