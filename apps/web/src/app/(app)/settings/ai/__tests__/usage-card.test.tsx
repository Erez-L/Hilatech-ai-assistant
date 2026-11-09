import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiUsageSummary } from '@hilatech/contracts';
import { renderWithProviders, seedSession } from '@/test/render';
import { mockApi } from '@/test/fetch';
import { UsageCard } from '../usage-card';

function summary(over: Partial<AiUsageSummary> = {}): AiUsageSummary {
  return {
    period: { from: '2026-11-01T00:00:00.000Z', to: '2026-11-09T00:00:00.000Z' },
    requests: 3,
    inputTokens: 1200,
    outputTokens: 300,
    totalTokens: 1500,
    estimatedCostUsd: null,
    errorCount: 1,
    byModel: [
      {
        provider: 'mock',
        model: 'mock-chat',
        requests: 3,
        inputTokens: 1200,
        outputTokens: 300,
        estimatedCostUsd: null,
      },
    ],
    byAgent: [{ agentId: null, agentName: null, requests: 3, totalTokens: 1500 }],
    limit: { tokens: 10_000, used: 9_500 },
    ...over,
  };
}

describe('UsageCard', () => {
  beforeEach(() => seedSession(['ai:config:read']));
  afterEach(() => vi.unstubAllGlobals());

  it('says “No pricing configured” instead of inventing a cost', async () => {
    mockApi({ 'GET /ai/usage/summary': () => summary() });
    renderWithProviders(<UsageCard />);
    expect(await screen.findByText('No pricing configured')).toBeInTheDocument();
    expect(screen.getByText('mock-chat')).toBeInTheDocument();
    expect(screen.getByText('Assistant & other')).toBeInTheDocument();
    // Plan limit meter near the ceiling.
    expect(screen.getByRole('meter', { name: 'Plan token usage' })).toHaveAttribute(
      'aria-valuenow',
      '9500',
    );
  });

  it('shows the estimated cost when pricing exists', async () => {
    mockApi({
      'GET /ai/usage/summary': () =>
        summary({ estimatedCostUsd: 0.0123, limit: { tokens: null, used: 1500 } }),
    });
    renderWithProviders(<UsageCard />);
    expect(await screen.findByText('$0.0123')).toBeInTheDocument();
    expect(screen.queryByText('No pricing configured')).toBeNull();
    expect(screen.getByText(/no limit on this plan/)).toBeInTheDocument();
  });
});
