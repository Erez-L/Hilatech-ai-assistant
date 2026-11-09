import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_LIMITS } from '@hilatech/contracts';
import { renderWithProviders, seedSession } from '@/test/render';
import { json, mockApi, paginatedBody } from '@/test/fetch';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/settings/billing',
  useSearchParams: () => new URLSearchParams(),
}));

import { BillingView } from '../billing-view';

const subscription = {
  plan: 'free',
  status: 'active',
  limits: PLAN_LIMITS.free,
  currentPeriodStart: '2026-11-01T00:00:00.000Z',
  currentPeriodEnd: '2026-12-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  provider: null,
  providerSubscriptionId: null,
};

const ent = (over: Record<string, unknown>) => ({
  key: 'seats',
  label: 'Seats',
  unit: 'count',
  used: 1,
  limit: 2,
  percent: 50,
  state: 'ok',
  basis: 'stock',
  enforced: true,
  ...over,
});

const entitlements = {
  plan: 'free',
  status: 'active',
  periodStart: '2026-11-01T00:00:00.000Z',
  periodEnd: '2026-12-01T00:00:00.000Z',
  entitlements: [
    ent({}),
    ent({
      key: 'ai_tokens',
      label: 'AI tokens',
      unit: 'tokens',
      used: 85_000,
      limit: 100_000,
      percent: 85,
      state: 'warning',
      basis: 'period',
      enforced: false,
    }),
    ent({
      key: 'documents',
      label: 'Knowledge documents',
      used: 10,
      limit: 10,
      percent: 100,
      state: 'exceeded',
    }),
  ],
};

function budget(over: Record<string, unknown> = {}) {
  return {
    settings: {
      monthlyTokenBudget: null,
      monthlyCostBudgetUsd: null,
      warnThresholdPct: 80,
      hardStopEnabled: false,
      updatedAt: null,
      updatedById: null,
    },
    periodStart: '2026-11-01T00:00:00.000Z',
    periodEnd: '2026-12-01T00:00:00.000Z',
    tokens: { used: 0, budget: null, percent: null, level: 'ok' },
    cost: {
      usedUsd: null,
      budgetUsd: null,
      percent: null,
      level: 'ok',
      enforceable: false,
      pricedRequests: 0,
      unpricedRequests: 0,
      note: 'No model pricing is configured (AI_PRICING_JSON).',
    },
    blocked: false,
    ...over,
  };
}

const upgradeOptions = {
  currentPlan: 'free',
  subscriptionStatus: 'active',
  pressure: [ent({ key: 'documents', label: 'Knowledge documents', state: 'exceeded' })],
  options: [
    {
      plan: {
        key: 'starter',
        name: 'Starter',
        rank: 1,
        limits: PLAN_LIMITS.starter,
        pricing: { configured: false, note: 'n/a' },
      },
      limitDeltas: { seats: 3, aiTokensPerMonth: 400_000, knowledgeDocuments: 90 },
      resolves: ['documents'],
    },
  ],
  payment: {
    configured: false,
    provider: null,
    message: 'No payment provider is configured, so plans cannot be purchased yet.',
  },
};

const alertsBody = paginatedBody([
  {
    id: 'a1',
    organizationId: 'o',
    periodStart: '2026-11-01T00:00:00.000Z',
    scope: 'budget_tokens',
    kind: 'exceeded',
    used: 1200,
    limit: 1000,
    thresholdPct: 100,
    createdAt: '2026-11-09T10:00:00.000Z',
  },
]);

function routes(extra: Record<string, () => unknown> = {}) {
  return {
    'GET /billing/subscription': () => subscription,
    'GET /billing/entitlements': () => entitlements,
    'GET /billing/budget': () => budget(),
    'GET /billing/upgrade-options': () => upgradeOptions,
    'GET /billing/alerts': () => alertsBody,
    'GET /billing/plans': () => [
      { key: 'free', limits: PLAN_LIMITS.free },
      { key: 'starter', limits: PLAN_LIMITS.starter },
    ],
    ...extra,
  };
}

describe('BillingView', () => {
  beforeEach(() => seedSession(['organization:read', 'organization:billing:manage']));
  afterEach(() => vi.unstubAllGlobals());

  it('shows the plan and entitlement meters with warning and exceeded states in words', async () => {
    mockApi(routes());
    renderWithProviders(<BillingView />);
    expect((await screen.findAllByText('Free')).length).toBeGreaterThan(0);

    const list = await screen.findByRole('list', { name: 'Entitlements' });
    const tokens = within(list).getByTestId('entitlement-ai_tokens');
    expect(tokens).toHaveAttribute('data-state', 'warning');
    expect(tokens).toHaveTextContent('Warning');
    expect(tokens).toHaveTextContent('Approaching the limit');
    expect(tokens).toHaveTextContent('Reported only');
    const docs = within(list).getByTestId('entitlement-documents');
    expect(docs).toHaveTextContent('Limit reached');
    expect(docs).toHaveTextContent('Enforced');
    expect(
      within(docs).getByRole('meter', { name: 'Knowledge documents usage' }),
    ).toBeInTheDocument();
    expect(within(list).getByTestId('entitlement-seats')).not.toHaveTextContent('Warning');
  });

  it('lists upgrade options with deltas, what they resolve, and the honest 501 outcome', async () => {
    const { calls } = mockApi(
      routes({
        'POST /billing/checkout': () =>
          json(
            {
              error: {
                code: 'PAYMENT_NOT_CONFIGURED',
                message: 'No payment provider is configured.',
              },
            },
            501,
          ),
      }),
    );
    renderWithProviders(<BillingView />);
    const card = await screen.findByTestId('upgrade-starter');
    expect(card).toHaveTextContent('+3 seats');
    expect(card).toHaveTextContent('+400K ai tokens / month');
    expect(card).toHaveTextContent('Resolves: documents');
    expect(card).toHaveTextContent('Pricing not configured');
    expect(
      screen.getByText('No payment provider is configured, so plans cannot be purchased yet.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Upgrade to Starter' }));
    const note = await screen.findByTestId('payment-not-configured');
    expect(note).toHaveTextContent('Payment is not configured');
    expect(note).toHaveTextContent('plan has not changed');
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ plan: 'starter' });
  });

  it('saves the budget with null for empty fields and shows cost as requiring pricing', async () => {
    const { calls } = mockApi(
      routes({
        'PUT /billing/budget': () => {
          return budget({
            settings: {
              monthlyTokenBudget: 5000,
              monthlyCostBudgetUsd: null,
              warnThresholdPct: 90,
              hardStopEnabled: true,
              updatedAt: '2026-11-09T11:00:00.000Z',
              updatedById: null,
            },
            tokens: { used: 0, budget: 5000, percent: 0, level: 'ok' },
          });
        },
      }),
    );
    renderWithProviders(<BillingView />);
    expect(await screen.findByTestId('cost-budget-requires-pricing')).toHaveTextContent(
      'requires pricing configuration',
    );
    expect(
      screen.getByText(/Requires pricing configuration: without model prices/),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Monthly token budget'), '5000');
    const warn = screen.getByLabelText('Warn at (%)');
    await userEvent.clear(warn);
    await userEvent.type(warn, '90');
    await userEvent.click(screen.getByRole('switch', { name: /Hard stop/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save budget' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      monthlyTokenBudget: 5000,
      monthlyCostBudgetUsd: null,
      warnThresholdPct: 90,
      hardStopEnabled: true,
    });
    expect(await screen.findByText('Budget saved.')).toBeInTheDocument();
  });

  it('validates the budget form before calling the API', async () => {
    const { calls } = mockApi(routes());
    renderWithProviders(<BillingView />);
    await screen.findByTestId('cost-budget-requires-pricing');
    await userEvent.click(screen.getByRole('switch', { name: /Hard stop/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(
      await screen.findByText(/Set a token or cost budget before turning on/),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Monthly token budget'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    expect(await screen.findByText('Enter a whole number of tokens')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('shows the blocked banner, alerts, and read-only controls without the billing permission', async () => {
    mockApi(
      routes({
        'GET /billing/budget': () =>
          budget({
            blocked: true,
            settings: {
              monthlyTokenBudget: 1000,
              monthlyCostBudgetUsd: null,
              warnThresholdPct: 80,
              hardStopEnabled: true,
              updatedAt: '2026-11-09T11:00:00.000Z',
              updatedById: null,
            },
            tokens: { used: 1200, budget: 1000, percent: 120, level: 'exceeded' },
          }),
      }),
    );
    renderWithProviders(<BillingView />);
    expect(await screen.findByTestId('budget-blocked')).toHaveTextContent(
      'AI requests are blocked',
    );
    const alerts = await screen.findByRole('table', { name: 'Budget alerts' });
    expect(alerts).toHaveTextContent('AI token budget');
    expect(alerts).toHaveTextContent('Exceeded');
  });

  it('is read-only for members who can read the organization but not manage billing', async () => {
    seedSession(['organization:read']);
    const { calls } = mockApi(routes());
    renderWithProviders(<BillingView />);
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.getByLabelText('Monthly token budget')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save budget' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: 'Upgrade to Starter' })).toBeDisabled();
    expect(screen.getByText('Alerts are restricted')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/billing/alerts')).toBe(false);
  });

  it('shows an error state with retry when entitlements fail', async () => {
    mockApi(
      routes({
        'GET /billing/entitlements': () =>
          json({ error: { code: 'INTERNAL_ERROR', message: 'nope' } }, 500),
      }),
    );
    renderWithProviders(<BillingView />);
    expect(await screen.findByText('Plan usage couldn’t be loaded')).toBeInTheDocument();
  });

  it('is blocked for members without any organization permission', () => {
    seedSession([]);
    mockApi({});
    renderWithProviders(<BillingView />);
    expect(screen.getByText('You don’t have access to this page')).toBeInTheDocument();
  });
});
