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
          reject(
            new AiProviderError({
              provider: 'mock',
              code: 'timeout',
              message: 'Request aborted',
              retryable: false,
            }),
          );
        });
      });
    }
    if (request.signal?.aborted) {
      throw new AiProviderError({
        provider: 'mock',
        code: 'timeout',
        message: 'Request aborted',
        retryable: false,
      });
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
        ? turn.toolCalls.map((c) => ({
            id: `mock_call_${++this.callCounter}`,
            name: c.name,
            input: c.input,
          }))
        : [];
    const textOut = 'structured' in turn ? JSON.stringify(turn.structured) : (turn.text ?? '');
    return {
      text: textOut,
      toolCalls,
      finishReason: toolCalls.length ? 'tool_calls' : 'stop',
      usage: {
        inputTokens:
          estimateMessagesTokens(request.messages) + estimateTokens(request.system ?? ''),
        outputTokens: estimateTokens(textOut) + toolCalls.length * 10,
      },
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
    const raw: string =
      'structured' in turn ? JSON.stringify(turn.structured) : (turn.text ?? '{}');
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new AiProviderError({
        provider: 'mock',
        code: 'invalid_request',
        message: 'mock structured output was not JSON',
        retryable: false,
      });
    }
    const parsed = request.schema.safeParse(value);
    if (!parsed.success) {
      throw new AiProviderError({
        provider: 'mock',
        code: 'invalid_request',
        message: `mock structured output invalid: ${parsed.error.message}`,
        retryable: false,
      });
    }
    return {
      data: parsed.data as T,
      usage: {
        inputTokens: estimateMessagesTokens(request.messages),
        outputTokens: estimateTokens(raw),
      },
      model: request.model,
      raw,
    };
  }

  /**
   * Deterministic pseudo-embeddings for tests and local development. Bag-of-words feature hashing:
   * every lowercase word (and word bigram, at half weight) is hashed (FNV-1a) to a signed bucket, then the
   * vector is L2-normalised. Texts that share vocabulary therefore have a high cosine similarity and
   * unrelated texts a low one, so retrieval can be verified end to end without a real model. 64
   * dimensions unless `dimensions` is requested (the knowledge pipeline asks for 1536).
   */
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const dims = request.dimensions ?? 64;
    const embeddings = request.input.map((textValue) => mockEmbedding(textValue, dims));
    return {
      embeddings,
      usage: { inputTokens: request.input.reduce((s, t) => s + estimateTokens(t), 0) },
      model: request.model,
      dimensions: dims,
    };
  }

  async healthCheck(): Promise<HealthResult> {
    return { ok: true, latencyMs: this.latencyMs, error: null };
  }
}

const MOCK_STOP_WORDS = new Set(
  (
    'a an the is are was were be been of to in on at by for from with and or but not no it its this that these those ' +
    'what which who whom how do does did can could should would will we you your our i my me us they them their ' +
    'את של על עם או אם זה זו הוא היא הם הן אני אנחנו מה איך'
  ).split(' '),
);

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Exported for tests: the deterministic embedding the mock provider returns for one text. */
export function mockEmbedding(text: string, dims: number): number[] {
  const vector = new Array<number>(dims).fill(0);
  const allWords = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  // Drop stop words so shared filler ("the", "is") does not make unrelated texts look similar.
  const content = allWords.filter((word) => !MOCK_STOP_WORDS.has(word));
  const words = content.length > 0 ? content : allWords;
  const add = (feature: string, weight: number) => {
    const h = fnv1a(feature);
    const index = h % dims;
    vector[index] = (vector[index] ?? 0) + (((h >>> 16) & 1) === 0 ? weight : -weight);
  };
  words.forEach((word, i) => {
    add(word, 1);
    const next = words[i + 1];
    if (next) add(`${word} ${next}`, 0.5);
  });
  if (words.length === 0) {
    // No word characters (punctuation, empty): fall back to character hashing so the vector is non-zero.
    for (let i = 0; i < text.length; i += 1) add(`c${text.charCodeAt(i)}:${i % 7}`, 1);
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}
