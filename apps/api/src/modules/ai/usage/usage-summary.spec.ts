import { type UsageRow, buildUsageSummary } from './usage-summary';

const period = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-12-01T00:00:00Z') };
const row = (o: Partial<UsageRow> = {}): UsageRow => ({
  provider: 'openai',
  model: 'gpt-4o-mini',
  agentId: null,
  status: 'success',
  inputTokens: 100,
  outputTokens: 50,
  estimatedCostUsd: 0.001,
  ...o,
});
const limit = { tokens: 1000, used: 300 };

describe('buildUsageSummary', () => {
  it('aggregates totals, per model and per agent and sums known costs', () => {
    const s = buildUsageSummary({
      period,
      limit,
      agentNames: new Map([['a1', 'Researcher']]),
      rows: [
        row({ agentId: 'a1' }),
        row({ agentId: 'a1' }),
        row({ model: 'gpt-4.1', estimatedCostUsd: 0.01 }),
      ],
    });
    expect(s).toMatchObject({
      requests: 3,
      inputTokens: 300,
      outputTokens: 150,
      totalTokens: 450,
      errorCount: 0,
    });
    expect(s.estimatedCostUsd).toBeCloseTo(0.012, 6);
    expect(s.byModel.find((m) => m.model === 'gpt-4o-mini')).toMatchObject({
      requests: 2,
      estimatedCostUsd: 0.002,
    });
    expect(s.byAgent[0]).toEqual({
      agentId: 'a1',
      agentName: 'Researcher',
      requests: 2,
      totalTokens: 300,
    });
    expect(s.limit).toEqual(limit);
    expect(s.period.from).toBe('2026-11-01T00:00:00.000Z');
  });

  it('reports a null cost when any successful request lacks pricing (per model and overall)', () => {
    const s = buildUsageSummary({
      period,
      limit,
      agentNames: new Map(),
      rows: [row(), row({ model: 'unpriced', estimatedCostUsd: null })],
    });
    expect(s.estimatedCostUsd).toBeNull();
    expect(s.byModel.find((m) => m.model === 'unpriced')?.estimatedCostUsd).toBeNull();
    expect(s.byModel.find((m) => m.model === 'gpt-4o-mini')?.estimatedCostUsd).toBe(0.001);
  });

  it('counts failed requests as errors without making the cost unknown', () => {
    const s = buildUsageSummary({
      period,
      limit,
      agentNames: new Map(),
      rows: [
        row(),
        row({ status: 'error', inputTokens: 0, outputTokens: 0, estimatedCostUsd: null }),
      ],
    });
    expect(s.errorCount).toBe(1);
    expect(s.estimatedCostUsd).toBe(0.001);
  });

  it('is empty-safe', () => {
    const s = buildUsageSummary({ period, limit, agentNames: new Map(), rows: [] });
    expect(s).toMatchObject({
      requests: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      byModel: [],
      byAgent: [],
    });
  });

  it('treats a pre-aggregated row as `requests` requests and gives the same result as the expanded rows', () => {
    const agentNames = new Map([['a1', 'Researcher']]);
    const expanded = buildUsageSummary({
      period,
      limit,
      agentNames,
      rows: [
        row({ agentId: 'a1', status: 'error' }),
        row({ agentId: 'a1', status: 'error' }),
        row({ agentId: 'a1', status: 'error' }),
      ],
    });
    const grouped = buildUsageSummary({
      period,
      limit,
      agentNames,
      rows: [
        row({
          requests: 3,
          agentId: 'a1',
          status: 'error',
          inputTokens: 300,
          outputTokens: 150,
          estimatedCostUsd: 0.003,
        }),
      ],
    });
    expect(grouped).toEqual(expanded);
    expect(grouped.requests).toBe(3);
    expect(grouped.errorCount).toBe(3);
  });
});
