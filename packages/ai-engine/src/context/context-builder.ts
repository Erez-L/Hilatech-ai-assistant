import type { AiMessage } from '../providers/types';
import { estimateMessageTokens, estimateTokens } from '../tokens';

export interface ContextBuildInput {
  /** Hardened system prompt (already rendered). */
  system: string;
  /** Rolling summary of older turns, if any. */
  summary?: string | null;
  /** Full history, oldest first. Tool call/result pairs must be adjacent. */
  history: AiMessage[];
  /** Total budget for system + summary + history (tokens). */
  budgetTokens: number;
  /** Reserve for the model's answer; subtracted from the budget. */
  reserveForOutputTokens?: number;
}

export interface ContextBuildResult {
  system: string;
  messages: AiMessage[];
  estimatedTokens: number;
  /** Messages (oldest first) that did not fit and should be folded into the summary. */
  dropped: AiMessage[];
  /** True when the history had to be truncated. */
  truncated: boolean;
}

const SUMMARY_HEADER = 'Summary of the earlier part of this conversation (for context only):';

/**
 * Keeps the newest messages that fit the token budget. Never splits a tool call from its result:
 * if an assistant message with tool calls would be kept, the following tool message is kept too and
 * vice versa. The first kept message is always a `user` message (providers require it).
 */
export function buildContext(input: ContextBuildInput): ContextBuildResult {
  const reserve = input.reserveForOutputTokens ?? 0;
  let system = input.system;
  if (input.summary && input.summary.trim().length > 0) {
    system = `${system}\n\n${SUMMARY_HEADER}\n<data source="conversation-summary">\n${input.summary.trim()}\n</data>`;
  }
  const fixed = estimateTokens(system) + reserve;
  let remaining = input.budgetTokens - fixed;

  const kept: AiMessage[] = [];
  const history = input.history;
  let i = history.length - 1;
  while (i >= 0) {
    // Group a tool-result message with the assistant message that requested it.
    const group: AiMessage[] = [history[i] as AiMessage];
    if (history[i]?.role === 'tool' && i > 0 && history[i - 1]?.role === 'assistant') {
      group.unshift(history[i - 1] as AiMessage);
      i -= 1;
    }
    const cost = group.reduce((s, m) => s + estimateMessageTokens(m), 0);
    if (cost > remaining) break;
    remaining -= cost;
    kept.unshift(...group);
    i -= 1;
  }
  // Ensure the window starts with a user message.
  while (kept.length > 0 && kept[0]?.role !== 'user') {
    const removed = kept.shift();
    if (removed) remaining += estimateMessageTokens(removed);
  }
  const dropped = history.slice(0, history.length - kept.length);
  return {
    system,
    messages: kept,
    estimatedTokens: input.budgetTokens - reserve - remaining,
    dropped,
    truncated: dropped.length > 0,
  };
}

/** Wrap untrusted content (tool results, documents) so the model treats it as data. */
export function dataBlock(source: string, content: string): string {
  const safeSource = source.replace(/[^a-zA-Z0-9_.:/-]/g, '_').slice(0, 80);
  // Neutralise every closing-tag variant (`</data >`, `</ DATA\n>`, ...) so content cannot break out of its block.
  const safeContent = content.replace(/<\s*\/\s*data\b[^>]*>/gi, '</data_>');
  return `<data source="${safeSource}">\n${safeContent}\n</data>`;
}

/** Trim a tool result to keep the context small; keeps the head and notes the omission. */
export function truncateForContext(value: string, maxChars = 12_000): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n…[truncated ${value.length - maxChars} characters]`;
}
