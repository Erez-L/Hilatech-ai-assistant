import {
  type AiMessage,
  type AiPart,
  type RunResult,
  type ToolCallPart,
  type ToolResultPart,
  fromFunctionName,
  messageText,
  toFunctionName,
} from '@hilatech/ai-engine';
import {
  type AssistantMessage as AssistantMessageDto,
  type AssistantThread as AssistantThreadDto,
  type ToolCall,
  toolCallSchema,
} from '@hilatech/contracts';
import { type AssistantMessage, type AssistantThread, type Prisma } from '@hilatech/database';

import { isoOrNull, jsonObject } from '../../crm/crm.mappers';

// -----------------------------------------------------------------------------------------------
// DTOs
// -----------------------------------------------------------------------------------------------

export function toAssistantThread(row: AssistantThread): AssistantThreadDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    title: row.title,
    providerConfigId: row.providerConfigId,
    model: row.model,
    messageCount: row.messageCount,
    lastMessageAt: isoOrNull(row.lastMessageAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAssistantMessage(row: AssistantMessage): AssistantMessageDto {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    toolCalls: parseToolCalls(row.toolCalls),
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    metadata: jsonObject(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Stored tool calls use dotted tool keys (`crm.search_leads`), the same ids the `/ai/tools` catalogue exposes. */
export function parseToolCalls(value: unknown): ToolCall[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const calls: ToolCall[] = [];
  for (const item of value) {
    const parsed = toolCallSchema.safeParse(item);
    if (parsed.success) calls.push(parsed.data);
  }
  return calls.length ? calls : null;
}

// -----------------------------------------------------------------------------------------------
// Rows → engine history
// -----------------------------------------------------------------------------------------------

export type HistoryRow = Pick<
  AssistantMessage,
  'role' | 'content' | 'toolCalls' | 'toolCallId' | 'toolName' | 'metadata' | 'createdAt'
>;

export interface HistoryMapping {
  messages: AiMessage[];
  /** `createdAt` of the last row folded into `messages[i]` (for `summarizedUpTo`). */
  lastRowAt: Date[];
}

/**
 * Maps persisted messages (oldest first) to provider-neutral `AiMessage`s:
 *  - `user` → user text; `assistant` → text + `tool_call` parts; consecutive `tool` rows → one `tool`
 *    message with one `tool_result` part each (parallel tool calls answer in a single turn);
 *  - `system` rows are skipped (the system prompt is rebuilt every turn);
 *  - defensive repair: tool results without a preceding tool call, and tool calls never answered, are
 *    dropped so the history always satisfies the providers' pairing rules.
 */
export function rowsToHistory(rows: readonly HistoryRow[]): HistoryMapping {
  const messages: AiMessage[] = [];
  const lastRowAt: Date[] = [];

  const push = (message: AiMessage, at: Date) => {
    messages.push(message);
    lastRowAt.push(at);
  };

  for (const row of rows) {
    if (row.role === 'system') continue;
    if (row.role === 'user') {
      push({ role: 'user', parts: [{ type: 'text', text: row.content }] }, row.createdAt);
      continue;
    }
    if (row.role === 'assistant') {
      const parts: AiPart[] = [];
      if (row.content) parts.push({ type: 'text', text: row.content });
      for (const call of parseToolCalls(row.toolCalls) ?? []) {
        parts.push({
          type: 'tool_call',
          id: call.id,
          name: toFunctionName(call.name),
          input: call.input,
        });
      }
      if (parts.length === 0) parts.push({ type: 'text', text: '' });
      push({ role: 'assistant', parts }, row.createdAt);
      continue;
    }
    // role === 'tool'
    if (!row.toolCallId) continue;
    const previous = messages[messages.length - 1];
    const part: ToolResultPart = {
      type: 'tool_result',
      toolCallId: row.toolCallId,
      name: toFunctionName(row.toolName ?? 'unknown'),
      content: parseToolContent(row.content),
      isError: jsonObject(row.metadata).isError === true,
    };
    if (previous?.role === 'tool') {
      previous.parts.push(part);
      lastRowAt[lastRowAt.length - 1] = row.createdAt;
    } else if (previous?.role === 'assistant' && hasToolCall(previous, row.toolCallId)) {
      push({ role: 'tool', parts: [part] }, row.createdAt);
    }
    // otherwise: orphan tool result → dropped
  }

  // Strip tool calls that were never answered (e.g. a turn that failed mid-way).
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i] as AiMessage;
    if (message.role !== 'assistant') continue;
    const calls = message.parts.filter((p): p is ToolCallPart => p.type === 'tool_call');
    if (calls.length === 0) continue;
    const next = messages[i + 1];
    const answered = new Set(
      next?.role === 'tool'
        ? next.parts
            .filter((p): p is ToolResultPart => p.type === 'tool_result')
            .map((p) => p.toolCallId)
        : [],
    );
    message.parts = message.parts.filter((p) => p.type !== 'tool_call' || answered.has(p.id));
    if (message.parts.length === 0) message.parts.push({ type: 'text', text: '' });
  }

  return { messages, lastRowAt };
}

function hasToolCall(message: AiMessage, toolCallId: string): boolean {
  return message.parts.some((p) => p.type === 'tool_call' && p.id === toolCallId);
}

function parseToolContent(content: string): string | Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : content;
  } catch {
    return content;
  }
}

// -----------------------------------------------------------------------------------------------
// Engine transcript → rows
// -----------------------------------------------------------------------------------------------

export type TranscriptRow = Omit<Prisma.AssistantMessageUncheckedCreateInput, 'threadId' | 'id'> & {
  role: 'assistant' | 'tool';
};

/**
 * Turns the new messages of a run (the transcript minus the user message, which is persisted before
 * the run) into rows. Token totals of the run land on the final assistant message; tool results become
 * one `tool` row each (content = JSON string, `toolCallId` + `toolName`).
 */
export function transcriptToRows(
  transcript: readonly AiMessage[],
  result: Pick<RunResult, 'status' | 'usage' | 'durationMs' | 'estimatedCostUsd' | 'stepCount'>,
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const messages = transcript.filter((m) => m.role !== 'user');
  const lastAssistantIndex = findLastIndex(messages, (m) => m.role === 'assistant');

  messages.forEach((message, index) => {
    if (message.role === 'assistant') {
      const calls = message.parts
        .filter((p): p is ToolCallPart => p.type === 'tool_call')
        .map((p) => ({ id: p.id, name: fromFunctionName(p.name), input: p.input }));
      const isFinal = index === lastAssistantIndex;
      rows.push({
        role: 'assistant',
        content: messageText(message),
        toolCalls: calls.length ? (calls as unknown as Prisma.InputJsonValue) : undefined,
        inputTokens: isFinal ? result.usage.inputTokens : null,
        outputTokens: isFinal ? result.usage.outputTokens : null,
        metadata: isFinal
          ? {
              status: result.status,
              durationMs: result.durationMs,
              stepCount: result.stepCount,
              estimatedCostUsd: result.estimatedCostUsd,
            }
          : { status: 'intermediate' },
      });
      return;
    }
    for (const part of message.parts) {
      if (part.type !== 'tool_result') continue;
      rows.push({
        role: 'tool',
        content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
        toolCallId: part.toolCallId,
        toolName: fromFunctionName(part.name),
        metadata: { isError: part.isError === true },
      });
    }
  });
  return rows;
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) if (predicate(items[i] as T)) return i;
  return -1;
}
