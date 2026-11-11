import type { AiModelInfo } from '@hilatech/contracts';
import OpenAI from 'openai';
import { zodToJsonSchema } from '../json-schema';

import { AiProviderError, codeFromStatus, isAbortError } from '../errors';
import { stripSchemaMeta } from './anthropic';
import { listModels } from './models';
import type {
  AiMessage,
  AiProvider,
  EmbedRequest,
  EmbedResult,
  FinishReason,
  GenerateRequest,
  GenerateResult,
  HealthResult,
  ProviderCredentials,
  StreamEvent,
  StructuredRequest,
  StructuredResult,
  ToolCall,
} from './types';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

const DEFAULT_TIMEOUT_MS = 60_000;

/** Adapter for the OpenAI Chat Completions + Embeddings APIs (also works with OpenAI-compatible base URLs). */
export class OpenAiProvider implements AiProvider {
  readonly kind = 'openai' as const;
  private readonly client: OpenAI;

  constructor(credentials: ProviderCredentials, client?: OpenAI) {
    if (!credentials.apiKey && !client) {
      throw new AiProviderError({
        provider: 'openai',
        code: 'auth',
        message: 'OpenAI API key is missing',
      });
    }
    this.client =
      client ??
      new OpenAI({
        apiKey: credentials.apiKey,
        baseURL: credentials.baseUrl,
        ...(credentials.fetch ? { fetch: credentials.fetch } : {}),
        timeout: credentials.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRetries: 0,
      });
  }

  listModels(): AiModelInfo[] {
    return listModels('openai');
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    try {
      const response = await this.client.chat.completions.create(
        {
          model: request.model,
          messages: toOpenAiMessages(request),
          ...(request.tools?.length ? { tools: request.tools.map(toOpenAiTool) } : {}),
          ...(request.tools?.length && request.toolChoice
            ? { tool_choice: toToolChoice(request.toolChoice) }
            : {}),
          ...(request.maxTokens !== undefined ? { max_completion_tokens: request.maxTokens } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.stopSequences?.length ? { stop: request.stopSequences } : {}),
        },
        { signal: request.signal },
      );
      return fromOpenAiResponse(response, request.model);
    } catch (error) {
      throw normalise(error);
    }
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = await this.client.chat.completions.create(
        {
          model: request.model,
          messages: toOpenAiMessages(request),
          ...(request.tools?.length ? { tools: request.tools.map(toOpenAiTool) } : {}),
          ...(request.tools?.length && request.toolChoice
            ? { tool_choice: toToolChoice(request.toolChoice) }
            : {}),
          ...(request.maxTokens !== undefined ? { max_completion_tokens: request.maxTokens } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.stopSequences?.length ? { stop: request.stopSequences } : {}),
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: request.signal },
      );
    } catch (error) {
      throw normalise(error);
    }

    let textOut = '';
    const partial = new Map<number, { id: string; name: string; args: string }>();
    let finish: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let model = request.model;
    let responseId: string | undefined;

    try {
      for await (const chunk of stream) {
        model = chunk.model ?? model;
        responseId = chunk.id ?? responseId;
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) {
          textOut += choice.delta.content;
          yield { type: 'text_delta', delta: choice.delta.content };
        }
        for (const tc of choice.delta?.tool_calls ?? []) {
          const entry = partial.get(tc.index) ?? { id: tc.id ?? '', name: '', args: '' };
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.args += tc.function.arguments;
          partial.set(tc.index, entry);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    } catch (error) {
      throw normalise(error);
    }

    const toolCalls: ToolCall[] = [];
    for (const [, entry] of [...partial.entries()].sort((a, b) => a[0] - b[0])) {
      const call: ToolCall = {
        id: entry.id || `call_${toolCalls.length}`,
        name: entry.name,
        input: safeParseObject(entry.args),
      };
      toolCalls.push(call);
      yield { type: 'tool_call', toolCall: call };
    }

    yield {
      type: 'done',
      result: {
        text: textOut,
        toolCalls,
        finishReason: mapFinish(finish, toolCalls.length > 0),
        usage: { inputTokens, outputTokens },
        model,
        responseId,
      },
    };
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const name = request.schemaName ?? 'structured_output';
    const schema = stripSchemaMeta(zodToJsonSchema(request.schema));
    const run = async (messages: AiMessage[]): Promise<StructuredResult<T>> => {
      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = await this.client.chat.completions.create(
          {
            model: request.model,
            messages: toOpenAiMessages({ ...request, messages }),
            response_format: { type: 'json_schema', json_schema: { name, schema, strict: false } },
            ...(request.maxTokens !== undefined
              ? { max_completion_tokens: request.maxTokens }
              : {}),
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          },
          { signal: request.signal },
        );
      } catch (error) {
        throw normalise(error);
      }
      const raw = response.choices[0]?.message?.content ?? '';
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new StructuredValidationError(raw, 'output was not valid JSON');
      }
      const parsed = request.schema.safeParse(value);
      if (!parsed.success) throw new StructuredValidationError(raw, parsed.error.message);
      return {
        data: parsed.data as T,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
        model: response.model ?? request.model,
        raw,
      };
    };
    try {
      return await run(request.messages);
    } catch (error) {
      if (error instanceof StructuredValidationError) {
        return run([
          ...request.messages,
          { role: 'assistant', parts: [{ type: 'text', text: error.raw }] },
          {
            role: 'user',
            parts: [
              {
                type: 'text',
                text: `The previous output did not match the required schema: ${error.issues}. Return a corrected JSON object only.`,
              },
            ],
          },
        ]);
      }
      throw error;
    }
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    try {
      const response = await this.client.embeddings.create(
        {
          model: request.model,
          input: request.input,
          encoding_format: 'float',
          ...(request.dimensions && /text-embedding-3/.test(request.model)
            ? { dimensions: request.dimensions }
            : {}),
        },
        { signal: request.signal },
      );
      const embeddings = response.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
      return {
        embeddings,
        usage: { inputTokens: response.usage?.prompt_tokens ?? 0 },
        model: response.model ?? request.model,
        dimensions: embeddings[0]?.length ?? 0,
      };
    } catch (error) {
      throw normalise(error);
    }
  }

  async healthCheck(model = 'gpt-4o-mini'): Promise<HealthResult> {
    const started = Date.now();
    try {
      await this.generate({
        model,
        maxTokens: 8,
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'ping' }] }],
      });
      return { ok: true, latencyMs: Date.now() - started, error: null };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

class StructuredValidationError extends Error {
  constructor(
    readonly raw: string,
    readonly issues: string,
  ) {
    super('structured output failed validation');
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

export function toOpenAiMessages(
  request: Pick<GenerateRequest, 'system' | 'messages'>,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (request.system) out.push({ role: 'system', content: request.system });
  for (const message of request.messages) {
    if (message.role === 'tool') {
      for (const part of message.parts) {
        if (part.type === 'tool_result') {
          out.push({
            role: 'tool',
            tool_call_id: part.toolCallId,
            content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
          });
        }
      }
      continue;
    }
    if (message.role === 'assistant') {
      const textValue = message.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { text: string }).text)
        .join('');
      const calls = message.parts.filter((p) => p.type === 'tool_call') as Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }>;
      out.push({
        role: 'assistant',
        content: textValue.length > 0 ? textValue : null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
              })),
            }
          : {}),
      });
      continue;
    }
    // user: text parts (tool results inside a user message are also accepted for robustness)
    const textValue = message.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text: string }).text)
      .join('');
    if (textValue.length > 0) out.push({ role: 'user', content: textValue });
    for (const part of message.parts) {
      if (part.type === 'tool_result') {
        out.push({
          role: 'tool',
          tool_call_id: part.toolCallId,
          content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
        });
      }
    }
  }
  return out;
}

function toOpenAiTool(tool: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): ChatTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: stripSchemaMeta(tool.inputSchema),
    },
  };
}

function toToolChoice(
  choice: NonNullable<GenerateRequest['toolChoice']>,
): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption {
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice;
  return { type: 'function', function: { name: choice.name } };
}

function fromOpenAiResponse(
  response: OpenAI.Chat.Completions.ChatCompletion,
  requestedModel: string,
): GenerateResult {
  const choice = response.choices[0];
  const message = choice?.message;
  const toolCalls: ToolCall[] = [];
  for (const tc of message?.tool_calls ?? []) {
    if (tc.type !== 'function') continue;
    toolCalls.push({
      id: tc.id,
      name: tc.function.name,
      input: safeParseObject(tc.function.arguments),
    });
  }
  return {
    text: message?.content ?? '',
    toolCalls,
    finishReason: mapFinish(choice?.finish_reason ?? null, toolCalls.length > 0),
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
    model: response.model ?? requestedModel,
    responseId: response.id,
  };
}

function mapFinish(reason: string | null, hasToolCalls: boolean): FinishReason {
  if (hasToolCalls || reason === 'tool_calls' || reason === 'function_call') return 'tool_calls';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'stop') return 'stop';
  if (reason === 'content_filter') return 'content_filter';
  return 'other';
}

function safeParseObject(json: string): Record<string, unknown> {
  if (!json?.trim()) return {};
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  } catch {
    return { _raw: json };
  }
}

function normalise(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (isAbortError(error)) {
    return new AiProviderError({
      provider: 'openai',
      code: 'timeout',
      message: 'Request aborted',
      retryable: false,
      cause: error,
    });
  }
  const status = (error as { status?: number })?.status ?? null;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AiProviderError({
      provider: 'openai',
      code: 'timeout',
      message,
      status,
      cause: error,
    });
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AiProviderError({
      provider: 'openai',
      code: 'server',
      message,
      status,
      cause: error,
    });
  }
  return new AiProviderError({
    provider: 'openai',
    code: codeFromStatus(status),
    message,
    status,
    cause: error,
  });
}
