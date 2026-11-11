import Anthropic from '@anthropic-ai/sdk';
import type { AiModelInfo } from '@hilatech/contracts';
import { zodToJsonSchema } from '../json-schema';

import { AiProviderError, codeFromStatus, isAbortError } from '../errors';
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

type AnthropicMessageParam = Anthropic.Messages.MessageParam;
type AnthropicContentBlock = Anthropic.Messages.ContentBlockParam;
type AnthropicTool = Anthropic.Messages.Tool;

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Adapter for the Anthropic Messages API. Tool calls map to `tool_use` blocks and tool results to
 * `tool_result` blocks in a following `user` message, as the API requires.
 */
export class AnthropicProvider implements AiProvider {
  readonly kind = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(credentials: ProviderCredentials, client?: Anthropic) {
    if (!credentials.apiKey && !client) {
      throw new AiProviderError({
        provider: 'anthropic',
        code: 'auth',
        message: 'Anthropic API key is missing',
      });
    }
    this.client =
      client ??
      new Anthropic({
        apiKey: credentials.apiKey,
        baseURL: credentials.baseUrl,
        ...(credentials.fetch ? { fetch: credentials.fetch } : {}),
        timeout: credentials.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRetries: 0, // retries are handled by the orchestrator with its own budget
      });
  }

  listModels(): AiModelInfo[] {
    return listModels('anthropic');
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    try {
      const response = await this.client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(request.system ? { system: request.system } : {}),
          messages: toAnthropicMessages(request.messages),
          ...(request.tools?.length ? { tools: request.tools.map(toAnthropicTool) } : {}),
          ...(request.tools?.length && request.toolChoice
            ? { tool_choice: toToolChoice(request.toolChoice) }
            : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.stopSequences?.length ? { stop_sequences: request.stopSequences } : {}),
        },
        { signal: request.signal },
      );
      return fromAnthropicResponse(response);
    } catch (error) {
      throw normalise(error);
    }
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    let stream: AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>;
    try {
      stream = await this.client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          ...(request.system ? { system: request.system } : {}),
          messages: toAnthropicMessages(request.messages),
          ...(request.tools?.length ? { tools: request.tools.map(toAnthropicTool) } : {}),
          ...(request.tools?.length && request.toolChoice
            ? { tool_choice: toToolChoice(request.toolChoice) }
            : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.stopSequences?.length ? { stop_sequences: request.stopSequences } : {}),
          stream: true,
        },
        { signal: request.signal },
      );
    } catch (error) {
      throw normalise(error);
    }

    let textOut = '';
    const toolCalls: ToolCall[] = [];
    const partialTools = new Map<number, { id: string; name: string; json: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;
    let model = request.model;
    let responseId: string | undefined;

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            inputTokens = event.message.usage?.input_tokens ?? 0;
            model = event.message.model ?? model;
            responseId = event.message.id;
            break;
          case 'content_block_start':
            if (event.content_block.type === 'tool_use') {
              partialTools.set(event.index, {
                id: event.content_block.id,
                name: event.content_block.name,
                json: '',
              });
            }
            break;
          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              textOut += event.delta.text;
              yield { type: 'text_delta', delta: event.delta.text };
            } else if (event.delta.type === 'input_json_delta') {
              const partial = partialTools.get(event.index);
              if (partial) partial.json += event.delta.partial_json;
            }
            break;
          case 'content_block_stop': {
            const partial = partialTools.get(event.index);
            if (partial) {
              const call: ToolCall = {
                id: partial.id,
                name: partial.name,
                input: safeParseObject(partial.json),
              };
              toolCalls.push(call);
              partialTools.delete(event.index);
              yield { type: 'tool_call', toolCall: call };
            }
            break;
          }
          case 'message_delta':
            stopReason = event.delta.stop_reason ?? stopReason;
            outputTokens = event.usage?.output_tokens ?? outputTokens;
            break;
          default:
            break;
        }
      }
    } catch (error) {
      throw normalise(error);
    }

    yield {
      type: 'done',
      result: {
        text: textOut,
        toolCalls,
        finishReason: mapStopReason(stopReason, toolCalls.length > 0),
        usage: { inputTokens, outputTokens },
        model,
        responseId,
      },
    };
  }

  /** Structured output via a forced tool call whose input schema is the requested schema. */
  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const name = request.schemaName ?? 'structured_output';
    const jsonSchema = zodToJsonSchema(request.schema);
    const attempt = async (messages: AiMessage[]): Promise<StructuredResult<T>> => {
      const result = await this.generate({
        ...request,
        messages,
        tools: [
          {
            name,
            description: 'Return the structured result.',
            inputSchema: stripSchemaMeta(jsonSchema),
          },
        ],
        toolChoice: { name },
      });
      const call = result.toolCalls.find((c) => c.name === name);
      if (!call) {
        throw new AiProviderError({
          provider: 'anthropic',
          code: 'invalid_request',
          message: 'Model did not return the structured output tool call',
          retryable: false,
        });
      }
      const parsed = request.schema.safeParse(call.input);
      if (!parsed.success) {
        throw new StructuredValidationError(
          JSON.stringify(call.input),
          parsed.error.message,
          result,
        );
      }
      return {
        data: parsed.data as T,
        usage: result.usage,
        model: result.model,
        raw: JSON.stringify(call.input),
      };
    };
    try {
      return await attempt(request.messages);
    } catch (error) {
      if (error instanceof StructuredValidationError) {
        // One corrective retry: tell the model what was wrong.
        const retryMessages: AiMessage[] = [
          ...request.messages,
          { role: 'assistant', parts: [{ type: 'text', text: error.raw }] },
          {
            role: 'user',
            parts: [
              {
                type: 'text',
                text: `The previous output did not match the required schema: ${error.issues}. Return a corrected result.`,
              },
            ],
          },
        ];
        return attempt(retryMessages);
      }
      throw error;
    }
  }

  async embed(_request: EmbedRequest): Promise<EmbedResult> {
    throw new AiProviderError({
      provider: 'anthropic',
      code: 'unsupported',
      message:
        'Anthropic does not offer an embeddings API; configure an embedding-capable provider',
      retryable: false,
    });
  }

  async healthCheck(model = 'claude-haiku-4-5'): Promise<HealthResult> {
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
    readonly result: GenerateResult,
  ) {
    super('structured output failed validation');
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

export function toAnthropicMessages(messages: AiMessage[]): AnthropicMessageParam[] {
  const out: AnthropicMessageParam[] = [];
  for (const message of messages) {
    const blocks: AnthropicContentBlock[] = [];
    for (const part of message.parts) {
      if (part.type === 'text') {
        if (part.text.length > 0) blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'tool_call') {
        blocks.push({ type: 'tool_use', id: part.id, name: part.name, input: part.input });
      } else {
        blocks.push({
          type: 'tool_result',
          tool_use_id: part.toolCallId,
          content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
          ...(part.isError ? { is_error: true } : {}),
        });
      }
    }
    if (blocks.length === 0) continue;
    // Tool results must be sent with the `user` role.
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) {
      (last.content as AnthropicContentBlock[]).push(...blocks);
    } else {
      out.push({ role, content: blocks });
    }
  }
  return out;
}

function toAnthropicTool(tool: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: stripSchemaMeta(tool.inputSchema) as AnthropicTool['input_schema'],
  };
}

function toToolChoice(
  choice: NonNullable<GenerateRequest['toolChoice']>,
): Anthropic.Messages.ToolChoice {
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'required') return { type: 'any' };
  if (choice === 'none') return { type: 'none' };
  return { type: 'tool', name: choice.name };
}

function fromAnthropicResponse(response: Anthropic.Messages.Message): GenerateResult {
  let textOut = '';
  const toolCalls: ToolCall[] = [];
  for (const block of response.content) {
    if (block.type === 'text') textOut += block.text;
    else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  return {
    text: textOut,
    toolCalls,
    finishReason: mapStopReason(response.stop_reason, toolCalls.length > 0),
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
    model: response.model,
    responseId: response.id,
  };
}

function mapStopReason(reason: string | null | undefined, hasToolCalls: boolean): FinishReason {
  if (hasToolCalls || reason === 'tool_use') return 'tool_calls';
  if (reason === 'max_tokens') return 'max_tokens';
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'refusal') return 'content_filter';
  return 'other';
}

function safeParseObject(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value };
  } catch {
    return { _raw: json };
  }
}

/** Remove `$schema`/`definitions` keys providers reject; keep the object schema itself. */
export function stripSchemaMeta(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _s, definitions: _d, $defs: _dd, ...rest } = schema;
  if (rest.type === undefined) rest.type = 'object';
  return rest;
}

function normalise(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (isAbortError(error)) {
    return new AiProviderError({
      provider: 'anthropic',
      code: 'timeout',
      message: 'Request aborted',
      retryable: false,
      cause: error,
    });
  }
  const status = (error as { status?: number })?.status ?? null;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiProviderError({
      provider: 'anthropic',
      code: 'timeout',
      message,
      status,
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiProviderError({
      provider: 'anthropic',
      code: 'server',
      message,
      status,
      cause: error,
    });
  }
  return new AiProviderError({
    provider: 'anthropic',
    code: codeFromStatus(status),
    message,
    status,
    cause: error,
  });
}
