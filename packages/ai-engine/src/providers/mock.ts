import type { AiModelInfo } from '@hilatech/contracts';

import { AiProviderError } from '../errors';
import { estimateMessagesTokens, estimateTokens } from '../tokens';
import { listModels } from './models';
import type {
  AiProvider,
  EmbedRequest,
  EmbedResult,
  GenerateRequest,
  GenerateResult,
  HealthResult,
  StreamEvent,
  StructuredRequest,
  StructuredResult,
  ToolCall,
} from './types';
import { messageText } from './types';

/** A scripted turn: either text, or tool calls the "model" wants to make. */
export type MockTurn =
  | { text: string }
  | { toolCalls: Array<{ name: string; input: Record<string, unknown> }>; text?: string }
  | { error: AiProviderError }
  | { structured: unknown };

export interface MockProviderOptions {
  /** Turns are consumed in order; when exhausted the provider echoes the last user message. */
  script?: MockTurn[];
  /** Artificial latency per call (ms) — useful for timeout tests. */
  latencyMs?: number;
  /** Optional observer for assertions. */
  onRequest?: (request: GenerateRequest) => void;
}

/**
 * Deterministic in-process provider for tests and local development. It never leaves the process and
 * is refused by the factory in production. Default behaviour: echo the last user message, prefixed.
 */
export class MockProvider implements AiProvider {
  readonly kind = 'mock' as const;
  readonly requests: GenerateRequest[] = [];
  private readonly script: MockTurn[];
  private readonly latencyMs: number;
  private readonly onRequest?: (request: GenerateRequest) => void;
  private callCounter = 0;

  constructor(options: MockProviderOptions = {}) {
    this.script = [...(options.script ?? [])];
    this.latencyMs = options.latencyMs ?? 0;
    this.onRequest = options.onRequest;
  }

  listModels(): AiModelInfo[] {
    return listModels('mock');
  }

  private async nextTurn(request: GenerateRequest): Promise<MockTurn> {
    this.requests.push(request);
    this.onRequest?.(request);
    if (this.latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.latencyMs);
        request.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new AiProviderError({ provider: 'mock', code: 'timeout', message: 'Request aborted', retryable: false }));
        });
      });
    }
    if (request.signal?.aborted) {
      throw new AiProviderError({ provider: 'mock', code: 'timeout', message: 'Request aborted', retryable: false });
    }
    const scripted = this.script.shift();
    if (scripted) return scripted;
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    return { text: `mock: ${lastUser ? messageText(lastUser) : ''}`.trim() };
  }

  private toResult(turn: MockTurn, request: GenerateRequest): GenerateResult {
    if ('error' in turn) throw turn.error;
    const toolCalls: ToolCall[] =
      'toolCalls' in turn
        ? turn.toolCalls.map((c) => ({ id: `mock_call_${++this.callCounter}`, name: c.name, input: c.input }))
        : [];
    const textOut = 'structured' in turn ? JSON.stringify(turn.structured) : (turn.text ?? '');
    return {
      text: textOut,
      toolCalls,
      finishReason: toolCalls.length ? 'tool_calls' : 'stop',
      usage: { inputTokens: estimateMessagesTokens(request.messages) + estimateTokens(request.system ?? ''), outputTokens: estimateTokens(textOut) + toolCalls.length * 10 },
      model: request.model,
      responseId: `mock_${Date.now()}_${this.callCounter}`,
    };
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    return this.toResult(await this.nextTurn(request), request);
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    const result = this.toResult(await this.nextTurn(request), request);
    // Emit the text in a few chunks so streaming consumers are exercised.
    const chunkSize = Math.max(1, Math.ceil(result.text.length / 3));
    for (let i = 0; i < result.text.length; i += chunkSize) {
      yield { type: 'text_delta', delta: result.text.slice(i, i + chunkSize) };
    }
    for (const toolCall of result.toolCalls) yield { type: 'tool_call', toolCall };
    yield { type: 'done', result };
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const turn = await this.nextTurn({ ...request });
    if ('error' in turn) throw turn.error;
    const raw = 'structured' in turn ? JSON.stringify(turn.structured) : 'text' in turn ? turn.text : '{}';
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new AiProviderError({ provider: 'mock', code: 'invalid_request', message: 'mock structured output was not JSON', retryable: false });
    }
    const parsed = request.schema.safeParse(value);
    if (!parsed.success) {
      throw new AiProviderError({ provider: 'mock', code: 'invalid_request', message: `mock structured output invalid: ${parsed.error.message}`, retryable: false });
    }
    return { data: parsed.data as T, usage: { inputTokens: estimateMessagesTokens(request.messages), outputTokens: estimateTokens(raw) }, model: request.model, raw };
  }

  /** Deterministic pseudo-embeddings (hash-based) with 64 dimensions. */
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const dims = 64;
    const embeddings = request.input.map((textValue) => {
      const vector = new Array<number>(dims).fill(0);
      for (let i = 0; i < textValue.length; i += 1) {
        const code = textValue.charCodeAt(i);
        vector[(code + i) % dims] += ((code % 13) - 6) / 10;
      }
      const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
      return vector.map((v) => v / norm);
    });
    return { embeddings, usage: { inputTokens: request.input.reduce((s, t) => s + estimateTokens(t), 0) }, model: request.model, dimensions: dims };
  }

  async healthCheck(): Promise<HealthResult> {
    return { ok: true, latencyMs: this.latencyMs, error: null };
  }
}
