import type { AiModelInfo, AiProviderKind } from '@hilatech/contracts';
import type { ZodTypeAny } from 'zod';

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type AiRole = 'user' | 'assistant' | 'tool';

export type TextPart = { type: 'text'; text: string };
export type ToolCallPart = {
  type: 'tool_call';
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResultPart = {
  type: 'tool_result';
  toolCallId: string;
  name: string;
  content: string | Record<string, unknown>;
  isError?: boolean;
};
export type AiPart = TextPart | ToolCallPart | ToolResultPart;

/** Provider-neutral chat message. `tool` messages carry tool results only. */
export interface AiMessage {
  role: AiRole;
  parts: AiPart[];
}

export const text = (role: 'user' | 'assistant', value: string): AiMessage => ({
  role,
  parts: [{ type: 'text', text: value }],
});

export function messageText(message: AiMessage): string {
  return message.parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

// ---------------------------------------------------------------------------
// Tools as seen by the model
// ---------------------------------------------------------------------------

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (draft-07 compatible object schema). */
  inputSchema: Record<string, unknown>;
}

export type ToolChoice = 'auto' | 'none' | 'required' | { name: string };

// ---------------------------------------------------------------------------
// Requests / results
// ---------------------------------------------------------------------------

export interface GenerateRequest {
  model: string;
  system?: string;
  messages: AiMessage[];
  tools?: ToolSpec[];
  toolChoice?: ToolChoice;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  signal?: AbortSignal;
  /** Free-form, forwarded to the provider's metadata field where supported (never secrets). */
  metadata?: Record<string, string>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'max_tokens' | 'content_filter' | 'other';

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface GenerateResult {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: TokenUsage;
  model: string;
  /** Provider response id when available. */
  responseId?: string;
}

export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done'; result: GenerateResult };

export interface StructuredRequest<T> extends Omit<GenerateRequest, 'tools' | 'toolChoice'> {
  schema: ZodTypeAny;
  /** Name used for the synthetic tool / response format. */
  schemaName?: string;
  /** Parsed output is validated with `schema`; this type parameter documents the expected shape. */
  __type?: T;
}

export interface StructuredResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
  /** Raw JSON string the model produced (for logging). */
  raw: string;
}

export interface EmbedRequest {
  model: string;
  input: string[];
  /** Requested vector size (providers that support it, e.g. OpenAI text-embedding-3, shrink natively). */
  dimensions?: number;
  signal?: AbortSignal;
}

export interface EmbedResult {
  embeddings: number[][];
  usage: { inputTokens: number };
  model: string;
  dimensions: number;
}

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

export interface AiProvider {
  readonly kind: AiProviderKind;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  stream(request: GenerateRequest): AsyncIterable<StreamEvent>;
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(request: EmbedRequest): Promise<EmbedResult>;
  listModels(): AiModelInfo[];
  healthCheck(model?: string): Promise<HealthResult>;
}

export interface ProviderCredentials {
  apiKey?: string;
  baseUrl?: string;
  /** Default request timeout in ms (per call). */
  timeoutMs?: number;
}
