import { type AiProviderKind, type AiUsageSummary } from '@hilatech/contracts';

/** One `AiRequestLog` row reduced to what the summary needs (Decimal already converted). */
export interface UsageRow {
  provider: AiProviderKind;
  model: string;
  agentId: string | null;
  status: 'success' | 'error' | 'timeout' | 'cancelled';
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export interface UsageSummaryInput {
  period: { from: Date; to: Date };
  rows: UsageRow[];
  agentNames: ReadonlyMap<string, string>;
  limit: { tokens: number | null; used: number };
}

interface CostAccumulator {
  total: number;
  known: boolean;
}

function addCost(acc: CostAccumulator, row: UsageRow): void {
  // Error rows consume no tokens and are never priced; only successful calls decide "known cost".
  if (row.status !== 'success') return;
  if (row.estimatedCostUsd === null) acc.known = false;
  else acc.total += row.estimatedCostUsd;
}

function finishCost(acc: CostAccumulator): number | null {
  return acc.known ? Math.round(acc.total * 1_000_000) / 1_000_000 : null;
}

/**
 * Pure aggregation behind `GET /ai/usage/summary` (ADR-012: a cost is reported only when every
 * successful request in the group has a price; otherwise `null`, never a guess).
 */
export function buildUsageSummary(input: UsageSummaryInput): AiUsageSummary {
  const totalCost: CostAccumulator = { total: 0, known: true };
  let inputTokens = 0;
  let outputTokens = 0;
  let errorCount = 0;

  const byModel = new Map<
    string,
    {
      provider: AiProviderKind;
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cost: CostAccumulator;
    }
  >();
  const byAgent = new Map<
    string | null,
    { agentId: string | null; requests: number; totalTokens: number }
  >();

  for (const row of input.rows) {
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    if (row.status !== 'success') errorCount += 1;
    addCost(totalCost, row);

    const modelKey = `${row.provider}:${row.model}`;
    let model = byModel.get(modelKey);
    if (!model) {
      model = {
        provider: row.provider,
        model: row.model,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: { total: 0, known: true },
      };
      byModel.set(modelKey, model);
    }
    model.requests += 1;
    model.inputTokens += row.inputTokens;
    model.outputTokens += row.outputTokens;
    addCost(model.cost, row);

    let agent = byAgent.get(row.agentId);
    if (!agent) {
      agent = { agentId: row.agentId, requests: 0, totalTokens: 0 };
      byAgent.set(row.agentId, agent);
    }
    agent.requests += 1;
    agent.totalTokens += row.inputTokens + row.outputTokens;
  }

  return {
    period: { from: input.period.from.toISOString(), to: input.period.to.toISOString() },
    requests: input.rows.length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: input.rows.length === 0 ? 0 : finishCost(totalCost),
    errorCount,
    byModel: [...byModel.values()]
      .map((m) => ({
        provider: m.provider,
        model: m.model,
        requests: m.requests,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        estimatedCostUsd: finishCost(m.cost),
      }))
      .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)),
    byAgent: [...byAgent.values()]
      .map((a) => ({
        agentId: a.agentId,
        agentName: a.agentId ? (input.agentNames.get(a.agentId) ?? null) : null,
        requests: a.requests,
        totalTokens: a.totalTokens,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    limit: input.limit,
  };
}
