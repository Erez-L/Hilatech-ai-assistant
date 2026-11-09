import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentExecutionDetail } from '@hilatech/contracts';
import { renderWithProviders, seedSession } from '@/test/render';
import { mockApi } from '@/test/fetch';
import { ExecutionDetailView } from '../[id]/execution-detail-view';

const ID = '77777777-7777-4777-8777-777777777777';
const AGENT = { id: '66666666-6666-4666-8666-666666666666', name: 'Triage' };

function detail(over: Partial<AgentExecutionDetail> = {}): AgentExecutionDetail {
  return {
    id: ID,
    organizationId: '22222222-2222-4222-8222-222222222222',
    agentId: AGENT.id,
    agent: AGENT,
    parentExecutionId: null,
    rootExecutionId: null,
    triggeredByUserId: null,
    trigger: 'manual',
    status: 'running',
    input: 'hello',
    output: null,
    error: null,
    depth: 0,
    stepCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: null,
    startedAt: '2026-11-09T10:00:00.000Z',
    finishedAt: null,
    durationMs: null,
    createdAt: '2026-11-09T10:00:00.000Z',
    updatedAt: '2026-11-09T10:00:00.000Z',
    steps: [],
    children: [],
    ...over,
  };
}

describe('ExecutionDetailView', () => {
  beforeEach(() => {
    seedSession(['agents:read', 'agents:execute']);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('polls every 2 s while running and stops once the execution is terminal', async () => {
    let status: AgentExecutionDetail['status'] = 'running';
    const { calls } = mockApi({
      [`GET /agents/executions/${ID}`]: () =>
        status === 'running'
          ? detail()
          : detail({
              status,
              output: 'done',
              durationMs: 1200,
              stepCount: 1,
              inputTokens: 10,
              outputTokens: 4,
              steps: [
                {
                  id: '88888888-8888-4888-8888-888888888888',
                  executionId: ID,
                  index: 0,
                  type: 'tool_call',
                  name: 'time.now',
                  input: { tz: 'UTC' },
                  output: { now: 'x' },
                  status: 'succeeded',
                  error: null,
                  durationMs: 12,
                  inputTokens: null,
                  outputTokens: null,
                  createdAt: '2026-11-09T10:00:01.000Z',
                },
              ],
            }),
    });
    renderWithProviders(<ExecutionDetailView id={ID} />);
    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel run/ })).toBeInTheDocument();
    const count = () => calls.filter((c) => c.path === `/agents/executions/${ID}`).length;
    expect(count()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(count()).toBe(2);

    status = 'succeeded';
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(await screen.findByText('Succeeded')).toBeInTheDocument();
    expect(screen.getByText('time.now')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel run/ })).toBeNull();
    // No cost configured → an explicit dash, never a made-up number.
    expect(screen.getByText('No pricing configured')).toBeInTheDocument();

    const settled = count();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(count()).toBe(settled);
  });
});
