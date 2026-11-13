import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type ConverseStreamCommandOutput,
  type Message,
  type ToolConfiguration,
} from '@aws-sdk/client-bedrock-runtime';
import type { AiModelInfo } from '@hilatech/contracts';
import { zodToJsonSchema } from '../json-schema';

import { AiProviderError, codeFromStatus, isAbortError, type AiErrorCode } from '../errors';
import { stripSchemaMeta } from './anthropic';
import { DEFAULT_BEDROCK_HEALTH_MODEL, listModels } from './models';
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
import { ThinkingTagFilter, stripThinkingTags } from './thinking-filter';

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 60_000;
const EMBED_CONCURRENCY = 4;
/** Cohere Embed v3 accepts at most 96 texts per InvokeModel call (AWS docs, model-parameters-embed-v3). */
const COHERE_MAX_TEXTS = 96;
/** Titan Text Embeddings V2 accepted output sizes (AWS docs, titan-embedding-models). */
const TITAN_V2_DIMENSIONS = [256, 512, 1024] as const;

/**
 * The slice of `BedrockRuntimeClient` this adapter needs. Tests inject a fake; production uses the real
 * client, which resolves credentials through the AWS default provider chain (env vars, SSO profile,
 * ECS task role, ...). **No static access keys are read or stored by this adapter.**
 */
export interface BedrockSender {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

/**
 * Adapter for Amazon Bedrock using the model-agnostic Converse / ConverseStream APIs (tool use, system
 * prompts, usage) and InvokeModel for embeddings (Titan Text Embeddings V2, Cohere Embed v3).
 *
 * Verification status: unit-tested against a mocked client only. No live Bedrock call has been made.
 */
export class BedrockProvider implements AiProvider {
  readonly kind = 'bedrock' as const;
  private readonly client: BedrockSender;

  constructor(credentials: ProviderCredentials, client?: BedrockSender) {
    this.client =
      client ??
      new BedrockRuntimeClient({
        // Region: explicit config wins, otherwise the SDK's own chain (AWS_REGION, profile config).
        ...(credentials.region ? { region: credentials.region } : {}),
        // `baseUrl` is an optional endpoint override (e.g. a VPC interface endpoint URL).
        ...(credentials.baseUrl ? { endpoint: credentials.baseUrl } : {}),
        // Retries are handled by the orchestrator with its own budget.
        maxAttempts: 1,
        requestHandler: { requestTimeout: credentials.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      });
  }

  listModels(): AiModelInfo[] {
    return listModels('bedrock');
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    try {
      const output = (await this.client.send(
        new ConverseCommand(toConverseInput(request)),
        sendOptions(request),
      )) as ConverseCommandOutput;
      return fromConverseOutput(output, request.model);
    } catch (error) {
      throw normalise(error);
    }
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    let response: ConverseStreamCommandOutput;
    try {
      response = (await this.client.send(
        new ConverseStreamCommand(toConverseInput(request)),
        sendOptions(request),
      )) as ConverseStreamCommandOutput;
    } catch (error) {
      throw normalise(error);
    }

    let textOut = '';
    const thinking = new ThinkingTagFilter();
    const toolCalls: ToolCall[] = [];
    const partialTools = new Map<number, { id: string; name: string; json: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | undefined;

    try {
      for await (const event of response.stream ?? []) {
        if (event.contentBlockStart?.start?.toolUse) {
          const tu = event.contentBlockStart.start.toolUse;
          partialTools.set(event.contentBlockStart.contentBlockIndex ?? 0, {
            id: tu.toolUseId ?? '',
            name: tu.name ?? '',
            json: '',
          });
        } else if (event.contentBlockDelta) {
          const index = event.contentBlockDelta.contentBlockIndex ?? 0;
          const delta = event.contentBlockDelta.delta;
          if (delta?.text) {
            const visible = thinking.push(delta.text);
            if (visible) {
              textOut += visible;
              yield { type: 'text_delta', delta: visible };
            }
          } else if (delta?.toolUse) {
            const partial = partialTools.get(index);
            if (partial) partial.json += delta.toolUse.input ?? '';
          }
        } else if (event.contentBlockStop) {
          const index = event.contentBlockStop.contentBlockIndex ?? 0;
          const partial = partialTools.get(index);
          if (partial) {
            const call: ToolCall = {
              id: partial.id,
              name: partial.name,
              input: safeParseObject(partial.json),
            };
            toolCalls.push(call);
            partialTools.delete(index);
            yield { type: 'tool_call', toolCall: call };
          }
        } else if (event.messageStop) {
          stopReason = event.messageStop.stopReason;
          const rest = thinking.flush();
          if (rest) {
            textOut += rest;
            yield { type: 'text_delta', delta: rest };
          }
        } else if (event.metadata?.usage) {
          inputTokens = event.metadata.usage.inputTokens ?? 0;
          outputTokens = event.metadata.usage.outputTokens ?? 0;
        } else {
          // Mid-stream service errors arrive as union members (throttlingException, ...).
          const failure = streamException(event as unknown as Record<string, unknown>);
          if (failure) throw failure;
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
        model: request.model,
      },
    };
  }

  /**
   * Structured output via a forced tool call (works on every Converse model with tool support).
   * Bedrock also offers native `outputConfig.textFormat` JSON-schema output, but support varies by model and
   * has schema restrictions (all objects need additionalProperties:false, <=12 optional properties, ...),
   * so it is deliberately not the default here.
   */
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
          provider: 'bedrock',
          code: 'invalid_request',
          message: 'Model did not return the structured output tool call',
          retryable: false,
        });
      }
      const parsed = request.schema.safeParse(call.input);
      if (!parsed.success) {
        throw new StructuredValidationError(JSON.stringify(call.input), parsed.error.message);
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

  /** Embeddings via InvokeModel. Titan V2 = one text per call; Cohere v3 = up to 96 texts per call. */
  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const family = embeddingFamily(request.model);
    if (family === 'unsupported') {
      throw new AiProviderError({
        provider: 'bedrock',
        code: 'unsupported',
        message: `Embedding model "${request.model}" is not supported by the Bedrock adapter (supported: amazon.titan-embed-text-v2:0, cohere.embed-english-v3, cohere.embed-multilingual-v3)`,
        retryable: false,
      });
    }
    try {
      if (family === 'titan-v2') return await this.embedTitan(request);
      return await this.embedCohere(request);
    } catch (error) {
      throw normalise(error);
    }
  }

  private async embedTitan(request: EmbedRequest): Promise<EmbedResult> {
    const dimensions = (TITAN_V2_DIMENSIONS as readonly number[]).includes(request.dimensions ?? -1)
      ? (request.dimensions as number)
      : 1024;
    const embeddings: number[][] = new Array<number[]>(request.input.length);
    let inputTokens = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < request.input.length) {
        const index = cursor++;
        const body = await this.invoke(request.model, request.signal, {
          inputText: request.input[index],
          dimensions,
          normalize: true,
        });
        const vector = body.embedding;
        if (!Array.isArray(vector)) {
          throw new AiProviderError({
            provider: 'bedrock',
            code: 'server',
            message: 'Titan embedding response had no "embedding" array',
          });
        }
        embeddings[index] = vector as number[];
        inputTokens += Number(body.inputTextTokenCount ?? 0);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(EMBED_CONCURRENCY, request.input.length) }, worker),
    );
    return { embeddings, usage: { inputTokens }, model: request.model, dimensions };
  }

  private async embedCohere(request: EmbedRequest): Promise<EmbedResult> {
    const embeddings: number[][] = [];
    for (let i = 0; i < request.input.length; i += COHERE_MAX_TEXTS) {
      const texts = request.input.slice(i, i + COHERE_MAX_TEXTS);
      const body = await this.invoke(request.model, request.signal, {
        texts,
        input_type: 'search_document',
        truncate: 'END',
      });
      const vectors = body.embeddings;
      if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new AiProviderError({
          provider: 'bedrock',
          code: 'server',
          message: 'Cohere embedding response had an unexpected "embeddings" shape',
        });
      }
      embeddings.push(...(vectors as number[][]));
    }
    // Cohere's InvokeModel response carries no token count; input tokens are reported as 0 (unknown).
    return {
      embeddings,
      usage: { inputTokens: 0 },
      model: request.model,
      dimensions: embeddings[0]?.length ?? 0,
    };
  }

  private async invoke(
    modelId: string,
    signal: AbortSignal | undefined,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const output = (await this.client.send(
      new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      }),
      { abortSignal: signal },
    )) as { body?: Uint8Array };
    if (!output.body) return {};
    return JSON.parse(new TextDecoder().decode(output.body)) as Record<string, unknown>;
  }

  async healthCheck(model = DEFAULT_BEDROCK_HEALTH_MODEL): Promise<HealthResult> {
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
// Mapping helpers (exported for tests)
// ---------------------------------------------------------------------------

function sendOptions(request: GenerateRequest): { abortSignal?: AbortSignal } {
  return request.signal ? { abortSignal: request.signal } : {};
}

export function embeddingFamily(model: string): 'titan-v2' | 'cohere-v3' | 'unsupported' {
  if (/(^|\.)amazon\.titan-embed-text-v2/.test(model)) return 'titan-v2';
  if (/(^|\.)cohere\.embed-(english|multilingual)-v3/.test(model)) return 'cohere-v3';
  return 'unsupported';
}

/** Bedrock `requestMetadata` allows at most 16 string pairs with a restricted character set. */
function sanitizeMetadata(metadata: Record<string, string> | undefined) {
  if (!metadata) return undefined;
  const ok = /^[a-zA-Z0-9\s:_@$#=/+,.-]{1,256}$/;
  const entries = Object.entries(metadata)
    .filter(([k, v]) => ok.test(k) && ok.test(v))
    .slice(0, 16);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function toConverseInput(request: GenerateRequest): ConverseCommandInput {
  const messages = toConverseMessages(request.messages);
  const hasToolBlocks = messages.some((m) =>
    m.content?.some((b) => 'toolUse' in b || 'toolResult' in b),
  );
  const toolConfig = toToolConfig(request, hasToolBlocks);
  const metadata = sanitizeMetadata(request.metadata);
  return {
    modelId: request.model,
    messages,
    ...(request.system ? { system: [{ text: request.system }] } : {}),
    inferenceConfig: {
      maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.stopSequences?.length ? { stopSequences: request.stopSequences } : {}),
    },
    ...(toolConfig ? { toolConfig } : {}),
    ...(metadata ? { requestMetadata: metadata } : {}),
  };
}

function toToolConfig(
  request: GenerateRequest,
  hasToolBlocks: boolean,
): ToolConfiguration | undefined {
  const tools = request.tools ?? [];
  // Converse has no "none" tool choice: with tool_choice "none" and no tool history we simply send no tools.
  // With tool history Bedrock requires a toolConfig, so the tools stay (choice auto) — documented limitation.
  if (tools.length === 0) return undefined;
  if (request.toolChoice === 'none' && !hasToolBlocks) return undefined;
  const choice = request.toolChoice;
  return {
    tools: tools.map((tool) => ({
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: { json: stripSchemaMeta(tool.inputSchema) as never },
      },
    })),
    ...(choice === 'required'
      ? { toolChoice: { any: {} } }
      : choice && typeof choice === 'object'
        ? { toolChoice: { tool: { name: choice.name } } }
        : choice === 'auto'
          ? { toolChoice: { auto: {} } }
          : {}),
  };
}

export function toConverseMessages(messages: AiMessage[]): Message[] {
  const out: Message[] = [];
  for (const message of messages) {
    const blocks: ContentBlock[] = [];
    for (const part of message.parts) {
      if (part.type === 'text') {
        // Converse rejects empty/blank text blocks.
        if (part.text.trim().length > 0) blocks.push({ text: part.text });
      } else if (part.type === 'tool_call') {
        blocks.push({
          toolUse: { toolUseId: part.id, name: part.name, input: part.input as never },
        });
      } else {
        blocks.push({
          toolResult: {
            toolUseId: part.toolCallId,
            content: [
              typeof part.content === 'string'
                ? { text: part.content.length > 0 ? part.content : '(empty)' }
                : { json: part.content as never },
            ],
            status: part.isError ? 'error' : 'success',
          },
        });
      }
    }
    if (blocks.length === 0) continue;
    // Tool results travel in a `user` turn.
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role && last.content) {
      last.content.push(...blocks);
    } else {
      out.push({ role, content: blocks });
    }
  }
  return out;
}

export function fromConverseOutput(
  response: ConverseCommandOutput,
  requestedModel: string,
): GenerateResult {
  let textOut = '';
  const toolCalls: ToolCall[] = [];
  for (const block of response.output?.message?.content ?? []) {
    if (block.text !== undefined) textOut += stripThinkingTags(block.text);
    else if (block.toolUse) {
      toolCalls.push({
        id: block.toolUse.toolUseId ?? '',
        name: block.toolUse.name ?? '',
        input: (block.toolUse.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  const requestId = response.$metadata?.requestId;
  return {
    text: textOut,
    toolCalls,
    finishReason: mapStopReason(response.stopReason, toolCalls.length > 0),
    usage: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
    },
    model: requestedModel,
    ...(requestId ? { responseId: requestId } : {}),
  };
}

function mapStopReason(reason: string | undefined, hasToolCalls: boolean): FinishReason {
  if (hasToolCalls || reason === 'tool_use') return 'tool_calls';
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'max_tokens';
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'guardrail_intervened' || reason === 'content_filtered') return 'content_filter';
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

const STREAM_EXCEPTION_KEYS: Record<string, AiErrorCode> = {
  throttlingException: 'rate_limited',
  modelStreamErrorException: 'server',
  internalServerException: 'server',
  serviceUnavailableException: 'server',
  validationException: 'invalid_request',
};

function streamException(event: Record<string, unknown>): AiProviderError | null {
  for (const [key, code] of Object.entries(STREAM_EXCEPTION_KEYS)) {
    const detail = event[key] as { message?: string } | undefined;
    if (detail) {
      return new AiProviderError({
        provider: 'bedrock',
        code,
        message: detail.message ?? key,
      });
    }
  }
  return null;
}

const ERROR_NAME_CODES: Record<string, AiErrorCode> = {
  ThrottlingException: 'rate_limited',
  ServiceQuotaExceededException: 'rate_limited',
  ModelNotReadyException: 'rate_limited',
  ModelTimeoutException: 'timeout',
  TimeoutError: 'timeout',
  AccessDeniedException: 'auth',
  UnrecognizedClientException: 'auth',
  ExpiredTokenException: 'auth',
  CredentialsProviderError: 'auth',
  ValidationException: 'invalid_request',
  ResourceNotFoundException: 'invalid_request',
  ModelErrorException: 'server',
  ModelStreamErrorException: 'server',
  InternalServerException: 'server',
  ServiceUnavailableException: 'server',
};

function normalise(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (isAbortError(error)) {
    return new AiProviderError({
      provider: 'bedrock',
      code: 'timeout',
      message: 'Request aborted',
      retryable: false,
      cause: error,
    });
  }
  const name = (error as { name?: string })?.name ?? '';
  const status =
    (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ?? null;
  let message = error instanceof Error ? error.message : String(error);
  const code = ERROR_NAME_CODES[name] ?? codeFromStatus(status);
  if (name === 'CredentialsProviderError') {
    message = `AWS credentials could not be resolved (default provider chain). Run \`aws sso login\` locally or attach an IAM role. ${message}`;
  } else if (name === 'AccessDeniedException') {
    message = `${message} (check IAM bedrock:InvokeModel permission, model availability in this region, and the Anthropic first-use form if applicable)`;
  }
  return new AiProviderError({ provider: 'bedrock', code, message, status, cause: error });
}
