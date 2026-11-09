import type { AiProviderKind } from '@hilatech/contracts';
import { z } from 'zod';

import type { TokenUsage } from '../providers/types';

/** USD per 1M tokens. Supplied by configuration (`AI_PRICING_JSON`) — the engine ships no prices. */
export const pricingEntrySchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'bedrock', 'mock']),
  model: z.string().min(1),
  inputPerMillionUsd: z.number().nonnegative(),
  outputPerMillionUsd: z.number().nonnegative(),
});
export type PricingEntry = z.infer<typeof pricingEntrySchema>;
export const pricingTableSchema = z.array(pricingEntrySchema);

export class PricingTable {
  private readonly entries = new Map<string, PricingEntry>();

  constructor(entries: PricingEntry[] = []) {
    for (const entry of entries) this.entries.set(key(entry.provider, entry.model), entry);
  }

  /** Parse `AI_PRICING_JSON`; invalid JSON or shape → empty table (and the caller logs it). */
  static fromJson(json: string | undefined | null): { table: PricingTable; error: string | null } {
    if (!json || !json.trim()) return { table: new PricingTable(), error: null };
    try {
      const parsed = pricingTableSchema.safeParse(JSON.parse(json));
      if (!parsed.success) return { table: new PricingTable(), error: parsed.error.message };
      return { table: new PricingTable(parsed.data), error: null };
    } catch (error) {
      return {
        table: new PricingTable(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  has(provider: AiProviderKind, model: string): boolean {
    return this.entries.has(key(provider, model));
  }

  /** Returns null when the model has no pricing — never a guess. */
  estimate(provider: AiProviderKind, model: string, usage: TokenUsage): number | null {
    const entry = this.entries.get(key(provider, model));
    if (!entry) return null;
    const cost =
      (usage.inputTokens / 1_000_000) * entry.inputPerMillionUsd +
      (usage.outputTokens / 1_000_000) * entry.outputPerMillionUsd;
    return Math.round(cost * 1_000_000) / 1_000_000;
  }

  size(): number {
    return this.entries.size;
  }
}

function key(provider: string, model: string): string {
  return `${provider}:${model}`;
}
