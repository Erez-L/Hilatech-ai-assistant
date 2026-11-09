import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission, type DashboardSummary } from '@hilatech/contracts';
import { renderWithProviders, seedSession } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const dashboard = vi.fn();
vi.mock('@/lib/api/analytics', () => ({
  analyticsApi: { dashboard: (...args: unknown[]) => dashboard(...args) },
}));
vi.mock('@/lib/api/billing', () => ({
  billingApi: {
    usage: vi.fn().mockResolvedValue({
      periodStart: '2026-11-01T00:00:00.000Z',
      periodEnd: '2026-12-01T00:00:00.000Z',
      metrics: { ai_tokens: { used: 10, limit: 100 } },
    }),
    subscription: vi.fn(),
    plans: vi.fn(),
  },
}));
vi.mock('@/lib/api/audit', () => ({
  auditApi: { list: vi.fn().mockResolvedValue({ data: [], meta: {} }) },
}));

import { DashboardView } from '../dashboard-view';

function summary(period: DashboardSummary['period']['key'], days: number): DashboardSummary {
  const series = Array.from({ length: days }).map((_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    count: i % 3,
  }));
  return {
    generatedAt: '2026-11-09T09:00:00.000Z',
    period: { key: period, from: '2026-10-01T00:00:00.000Z', to: '2026-11-09T00:00:00.000Z' },
    members: { active: 4, suspended: 1 },
    invitations: { pending: 2 },
    contacts: { total: 12, newInPeriod: 3 },
    leads: {
      total: 9,
      open: 6,
      newInPeriod: days,
      wonInPeriod: 2,
      lostInPeriod: 1,
      byStatus: { new: 3, contacted: 1, qualified: 1, proposal: 1, won: 2, lost: 1 },
      bySource: { website: 9 },
      pipelineValue: 15400,
      wonValueInPeriod: 2300,
      currency: 'USD',
    },
    conversations: {
      total: 5,
      open: 3,
      pending: 1,
      unassigned: 2,
      newInPeriod: 4,
      byStatus: { open: 3, pending: 1, resolved: 1, archived: 0 },
      byChannel: { web: 5 },
    },
    series: { leadsCreated: series, conversationsCreated: series },
    recentLeads: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Acme website',
        status: 'new',
        value: 1200,
        currency: 'USD',
        createdAt: '2026-11-08T10:00:00.000Z',
      },
    ],
    recentConversations: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        subject: 'Quote request',
        status: 'open',
        channel: 'web',
        lastMessageAt: '2026-11-08T11:00:00.000Z',
      },
    ],
  };
}

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedSession([
      Permission.ANALYTICS_READ,
      Permission.LEADS_READ,
      Permission.CONVERSATIONS_READ,
      Permission.AUDIT_READ,
    ]);
    dashboard.mockImplementation((period: DashboardSummary['period']['key'] = '30d') =>
      Promise.resolve(summary(period, period === '7d' ? 7 : period === '90d' ? 90 : 30)),
    );
  });

  it('renders the summary and re-queries when the period changes', async () => {
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText('Open leads')).toBeInTheDocument();
    expect(dashboard).toHaveBeenCalledWith('30d');
    expect(screen.getByText('Pipeline value')).toBeInTheDocument();
    expect(screen.getByText('$15.4K')).toBeInTheDocument();
    expect(screen.getByText('Unassigned conversations')).toBeInTheDocument();
    expect(screen.getByText('Team members')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Acme website/ })).toHaveAttribute(
      'href',
      '/leads/33333333-3333-4333-8333-333333333333',
    );
    expect(screen.getByRole('link', { name: /Quote request/ })).toHaveAttribute(
      'href',
      '/conversations?c=55555555-5555-4555-8555-555555555555',
    );

    await userEvent.click(screen.getByRole('radio', { name: '7 days' }));
    await waitFor(() => expect(dashboard).toHaveBeenCalledWith('7d'));
    expect(await screen.findByText('7 new in the last 7 days')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked();
  });

  it('explains when analytics are restricted instead of fetching', async () => {
    seedSession([Permission.LEADS_READ]);
    renderWithProviders(<DashboardView />);
    expect(await screen.findByText('Analytics are restricted')).toBeInTheDocument();
    expect(dashboard).not.toHaveBeenCalled();
  });
});
