import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AiProviderError } from '../errors';
import {
  BedrockProvider,
  embeddingFamily,
  toConverseInput,
  toConverseMessages,
  type BedrockSender,
} from '../providers/bedrock';
import { createProvider, requiresApiKey } from '../providers/factory';
import { BEDROCK_AVAILABILITY_NOTE, findModel, listModels } from '../providers/models';
import type { AiMessage } from '../providers/types';
import { PricingTable } from '../usage/pricing';

/**
 * UNIT TESTS ONLY. Every test below talks to a fake `BedrockSender`; NO live Amazon Bedrock call was made
 * and no AWS credentials were used. Response shapes follow the AWS docs / SDK type definitions, not observed traffic.
 */

interface Sent {
  name: string;
  input: Record<string, unknown>;
  options?: { abortSignal?: AbortSignal };
}

function fakeClient(respond: (sent: Sent) => unknown): { client: BedrockSender; sent: Sent[] } {
  const sent: Sent[] = [];
  const client: BedrockSender = {
    async send(command, options) {
      const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
      const entry: Sent = { name: cmd.constructor.name, input: cmd.input, options };
      sent.push(entry);
      const result = respond(entry);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { client, sent };
}

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const namedError = (name: string, status: number, message = name) =>
  Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } });

const conversation: AiMessage[] = [
  { role: 'user', parts: [{ type: 'text', text: 'find leads' }] },
  {
    role: 'assistant',
    parts: [
      { type: 'text', text: 'Searching' },
      { type: 'tool_call', id: 'c1', name: 'crm__search_leads', input: { query: 'acme' } },
    ],
  },
  {
    role: 'tool',
    parts: [
      { type: 'tool_result', toolCallId: 'c1', name: 'crm__search_leads', content: { ok: true } },
    ],
  },
  { role: 'user', parts: [{ type: 'text', text: 'thanks' }] },
];

describe('Bedrock message mapping', () => {
  it('maps tool calls/results to toolUse/toolResult blocks and merges consecutive user turns', () => {
    const mapped = toConverseMessages(conversation);
    expect(mapped.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(mapped[1]?.content?.[1]).toEqual({
      toolUse: { toolUseId: 'c1', name: 'crm__search_leads', input: { query: 'acme' } },
    });
    const last = mapped[2]?.content ?? [];
    expect(last[0]).toEqual({
      toolResult: { toolUseId: 'c1', content: [{ json: { ok: true } }], status: 'success' },
    });
    expect(last[1]).toEqual({ text: 'thanks' });
  });

  it('drops blank text blocks and flags tool errors', () => {
    const mapped = toConverseMessages([
      { role: 'user', parts: [{ type: 'text', text: '   ' }] },
      {
        role: 'tool',
        parts: [
          { type: 'tool_result', toolCallId: 'x', name: 't', content: 'boom', isError: true },
        ],
      },
    ]);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.content?.[0]).toEqual({
      toolResult: { toolUseId: 'x', content: [{ text: 'boom' }], status: 'error' },
    });
  });

  it('builds Converse input with system, inference config, tools and tool choice', () => {
    const input = toConverseInput({
      model: 'm',
      system: 'be brief',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      temperature: 0.2,
      maxTokens: 100,
      stopSequences: ['END'],
      tools: [
        {
          name: 'lookup',
          description: 'd',
          inputSchema: { $schema: 'x', type: 'object', properties: {} },
        },
      ],
      toolChoice: { name: 'lookup' },
      metadata: { tenant: 'abc', 'bad key!': 'x' },
    });
    expect(input.system).toEqual([{ text: 'be brief' }]);
    expect(input.inferenceConfig).toEqual({
      maxTokens: 100,
      temperature: 0.2,
      stopSequences: ['END'],
    });
    expect(input.toolConfig?.toolChoice).toEqual({ tool: { name: 'lookup' } });
    expect(input.toolConfig?.tools?.[0]?.toolSpec?.inputSchema).toEqual({
      json: { type: 'object', properties: {} },
    });
    expect(input.requestMetadata).toEqual({ tenant: 'abc' });
  });

  it('omits tools for toolChoice "none" without tool history, keeps them with history', () => {
    const tools = [{ name: 'a', description: 'd', inputSchema: { type: 'object' } }];
    const plain = toConverseInput({
      model: 'm',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      tools,
      toolChoice: 'none',
    });
    expect(plain.toolConfig).toBeUndefined();
    const withHistory = toConverseInput({
      model: 'm',
      messages: conversation,
      tools,
      toolChoice: 'none',
    });
    expect(withHistory.toolConfig?.tools).toHaveLength(1);
    expect(withHistory.toolConfig?.toolChoice).toBeUndefined();
    const required = toConverseInput({ model: 'm', messages: [], tools, toolChoice: 'required' });
    expect(required.toolConfig?.toolChoice).toEqual({ any: {} });
  });
});

describe('BedrockProvider.generate', () => {
  it('returns text, tool calls and usage from a Converse response', async () => {
    const { client, sent } = fakeClient(() => ({
      output: {
        message: {
          role: 'assistant',
          content: [
            { text: 'Looking. ' },
            { toolUse: { toolUseId: 't1', name: 'lookup', input: { q: 1 } } },
          ],
        },
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      $metadata: { requestId: 'req-1' },
    }));
    const provider = new BedrockProvider({}, client);
    const controller = new AbortController();
    const result = await provider.generate({
      model: 'amazon.nova-pro-v1:0',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      signal: controller.signal,
    });
    expect(sent[0]?.name).toBe('ConverseCommand');
    expect(sent[0]?.input.modelId).toBe('amazon.nova-pro-v1:0');
    expect(sent[0]?.options?.abortSignal).toBe(controller.signal);
    expect(result).toMatchObject({
      text: 'Looking. ',
      finishReason: 'tool_calls',
      usage: { inputTokens: 11, outputTokens: 7 },
      responseId: 'req-1',
    });
    expect(result.toolCalls).toEqual([{ id: 't1', name: 'lookup', input: { q: 1 } }]);
  });

  it.each([
    ['end_turn', 'stop'],
    ['max_tokens', 'max_tokens'],
    ['guardrail_intervened', 'content_filter'],
    ['something_new', 'other'],
  ])('maps stopReason %s to %s', async (stopReason, expected) => {
    const { client } = fakeClient(() => ({
      output: { message: { role: 'assistant', content: [{ text: 'x' }] } },
      stopReason,
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const result = await new BedrockProvider({}, client).generate({ model: 'm', messages: [] });
    expect(result.finishReason).toBe(expected);
  });

  it.each([
    ['ThrottlingException', 429, 'rate_limited', true],
    ['AccessDeniedException', 403, 'auth', false],
    ['ValidationException', 400, 'invalid_request', false],
    ['ModelTimeoutException', 408, 'timeout', true],
    ['InternalServerException', 500, 'server', true],
    ['CredentialsProviderError', 0, 'auth', false],
  ])('normalises %s to AiProviderError(%s)', async (name, status, code, retryable) => {
    const { client } = fakeClient(() => namedError(name, status));
    const error = await new BedrockProvider({}, client)
      .generate({ model: 'm', messages: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).code).toBe(code);
    expect((error as AiProviderError).retryable).toBe(retryable);
    expect((error as AiProviderError).provider).toBe('bedrock');
  });

  it('gives actionable guidance when credentials cannot be resolved', async () => {
    const { client } = fakeClient(() =>
      namedError('CredentialsProviderError', 0, 'Could not load credentials'),
    );
    const error = (await new BedrockProvider({}, client)
      .generate({ model: 'm', messages: [] })
      .catch((e: unknown) => e)) as AiProviderError;
    expect(error.message).toContain('aws sso login');
  });
});

describe('BedrockProvider.stream', () => {
  async function* events() {
    yield { messageStart: { role: 'assistant' } };
    yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'Hel' } } };
    yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'lo' } } };
    yield { contentBlockStop: { contentBlockIndex: 0 } };
    yield {
      contentBlockStart: {
        contentBlockIndex: 1,
        start: { toolUse: { toolUseId: 't9', name: 'lookup' } },
      },
    };
    yield { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '{"q":' } } } };
    yield { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '"x"}' } } } };
    yield { contentBlockStop: { contentBlockIndex: 1 } };
    yield { messageStop: { stopReason: 'tool_use' } };
    yield { metadata: { usage: { inputTokens: 5, outputTokens: 9 }, metrics: { latencyMs: 1 } } };
  }

  it('assembles text deltas, partial tool JSON, stop reason and usage', async () => {
    const { client, sent } = fakeClient(() => ({ stream: events() }));
    const out = [];
    for await (const e of new BedrockProvider({}, client).stream({ model: 'm', messages: [] }))
      out.push(e);
    expect(sent[0]?.name).toBe('ConverseStreamCommand');
    expect(
      out.filter((e) => e.type === 'text_delta').map((e) => (e as { delta: string }).delta),
    ).toEqual(['Hel', 'lo']);
    const done = out.at(-1);
    expect(done).toMatchObject({
      type: 'done',
      result: {
        text: 'Hello',
        finishReason: 'tool_calls',
        usage: { inputTokens: 5, outputTokens: 9 },
        toolCalls: [{ id: 't9', name: 'lookup', input: { q: 'x' } }],
      },
    });
  });

  it('surfaces mid-stream service exceptions as normalised errors', async () => {
    async function* broken() {
      yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'a' } } };
      yield { throttlingException: { message: 'slow down' } };
    }
    const { client } = fakeClient(() => ({ stream: broken() }));
    const run = async () => {
      for await (const _ of new BedrockProvider({}, client).stream({ model: 'm', messages: [] }))
        void _;
    };
    await expect(run()).rejects.toMatchObject({ code: 'rate_limited', provider: 'bedrock' });
  });
});

describe('BedrockProvider.generateStructured', () => {
  const schema = z.object({ title: z.string(), score: z.number() });
  const toolReply = (input: unknown) => ({
    output: {
      message: {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: 's', name: 'structured_output', input } }],
      },
    },
    stopReason: 'tool_use',
    usage: { inputTokens: 3, outputTokens: 4 },
  });

  it('forces the schema tool and validates the result', async () => {
    const { client, sent } = fakeClient(() => toolReply({ title: 'x', score: 2 }));
    const result = await new BedrockProvider({}, client).generateStructured({
      model: 'm',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'go' }] }],
      schema,
    });
    expect(result.data).toEqual({ title: 'x', score: 2 });
    const toolConfig = sent[0]?.input.toolConfig as { toolChoice: unknown };
    expect(toolConfig.toolChoice).toEqual({ tool: { name: 'structured_output' } });
  });

  it('retries once with corrective feedback, then fails if still invalid', async () => {
    let calls = 0;
    const { client } = fakeClient(() => {
      calls++;
      return toolReply(calls === 1 ? { title: 1 } : { title: 'ok', score: 1 });
    });
    const ok = await new BedrockProvider({}, client).generateStructured<{ title: string }>({
      model: 'm',
      messages: [],
      schema,
    });
    expect(calls).toBe(2);
    expect(ok.data.title).toBe('ok');

    const { client: bad } = fakeClient(() => toolReply({ nope: true }));
    await expect(
      new BedrockProvider({}, bad).generateStructured({ model: 'm', messages: [], schema }),
    ).rejects.toThrow();
  });
});

describe('BedrockProvider.embed', () => {
  it('Titan V2: one InvokeModel per text, requested dimensions, token counts summed, order preserved', async () => {
    const { client, sent } = fakeClient((s) => {
      const body = JSON.parse(String(s.input.body)) as { inputText: string };
      return { body: json({ embedding: [body.inputText.length, 0.5], inputTextTokenCount: 2 }) };
    });
    const result = await new BedrockProvider({}, client).embed({
      model: 'amazon.titan-embed-text-v2:0',
      input: ['a', 'bbb', 'cc'],
      dimensions: 512,
    });
    expect(result.embeddings.map((v) => v[0])).toEqual([1, 3, 2]);
    expect(result.usage.inputTokens).toBe(6);
    expect(result.dimensions).toBe(512);
    expect(sent).toHaveLength(3);
    expect(JSON.parse(String(sent[0]?.input.body))).toMatchObject({
      dimensions: 512,
      normalize: true,
    });
    expect(sent[0]?.name).toBe('InvokeModelCommand');
  });

  it('Titan V2: falls back to 1024 for unsupported dimensions (e.g. 1536)', async () => {
    const { client, sent } = fakeClient(() => ({
      body: json({ embedding: [1], inputTextTokenCount: 1 }),
    }));
    const result = await new BedrockProvider({}, client).embed({
      model: 'amazon.titan-embed-text-v2:0',
      input: ['a'],
      dimensions: 1536,
    });
    expect(result.dimensions).toBe(1024);
    expect(JSON.parse(String(sent[0]?.input.body)).dimensions).toBe(1024);
  });

  it('Cohere v3: batches 96 texts per call', async () => {
    const { client, sent } = fakeClient((s) => {
      const body = JSON.parse(String(s.input.body)) as { texts: string[] };
      return { body: json({ embeddings: body.texts.map(() => [0.1, 0.2, 0.3]) }) };
    });
    const input = Array.from({ length: 100 }, (_, i) => `t${i}`);
    const result = await new BedrockProvider({}, client).embed({
      model: 'cohere.embed-english-v3',
      input,
    });
    expect(sent).toHaveLength(2);
    expect(JSON.parse(String(sent[0]?.input.body))).toMatchObject({
      input_type: 'search_document',
      truncate: 'END',
    });
    expect(result.embeddings).toHaveLength(100);
    expect(result.dimensions).toBe(3);
  });

  it('rejects unsupported embedding models without calling AWS', async () => {
    const { client, sent } = fakeClient(() => ({}));
    await expect(
      new BedrockProvider({}, client).embed({ model: 'cohere.embed-v4:0', input: ['a'] }),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(sent).toHaveLength(0);
    expect(embeddingFamily('eu.amazon.titan-embed-text-v2:0')).toBe('titan-v2');
  });
});

describe('BedrockProvider.healthCheck', () => {
  it('reports ok with latency, and errors without throwing', async () => {
    const ok = fakeClient(() => ({
      output: { message: { role: 'assistant', content: [{ text: 'pong' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const good = await new BedrockProvider({}, ok.client).healthCheck('amazon.nova-micro-v1:0');
    expect(good.ok).toBe(true);
    expect(ok.sent[0]?.input.modelId).toBe('amazon.nova-micro-v1:0');

    const denied = fakeClient(() => namedError('AccessDeniedException', 403, 'no access'));
    const bad = await new BedrockProvider({}, denied.client).healthCheck();
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('no access');
  });
});

describe('Bedrock wiring', () => {
  it('is created by the factory without an API key (IAM / default credential chain)', () => {
    expect(requiresApiKey('bedrock')).toBe(false);
    expect(requiresApiKey('anthropic')).toBe(true);
    const provider = createProvider('bedrock', { region: 'us-east-1' });
    expect(provider.kind).toBe('bedrock');
  });

  it('registers Bedrock models flagged as unverified', () => {
    const models = listModels('bedrock');
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(m.provider).toBe('bedrock');
      expect(m.availabilityNote).toBe(BEDROCK_AVAILABILITY_NOTE);
    }
    expect(findModel('bedrock', 'amazon.titan-embed-text-v2:0')?.supportsEmbeddings).toBe(true);
    expect(listModels('anthropic').every((m) => m.availabilityNote === undefined)).toBe(true);
  });

  it('PricingTable accepts bedrock entries and never guesses missing prices', () => {
    const { table, error } = PricingTable.fromJson(
      JSON.stringify([
        {
          provider: 'bedrock',
          model: 'amazon.nova-micro-v1:0',
          inputPerMillionUsd: 1,
          outputPerMillionUsd: 2,
        },
      ]),
    );
    expect(error).toBeNull();
    expect(
      table.estimate('bedrock', 'amazon.nova-micro-v1:0', {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
      }),
    ).toBe(2);
    expect(table.estimate('bedrock', 'unknown', { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
});
