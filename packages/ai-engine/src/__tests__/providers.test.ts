import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AiProviderError } from '../errors';
import { toAnthropicMessages } from '../providers/anthropic';
import { createProvider } from '../providers/factory';
import { MockProvider } from '../providers/mock';
import { findModel, listModels } from '../providers/models';
import { toOpenAiMessages } from '../providers/openai';
import type { AiMessage } from '../providers/types';
import { PricingTable } from '../usage/pricing';

const conversation: AiMessage[] = [
  { role: 'user', parts: [{ type: 'text', text: 'find leads' }] },
  { role: 'assistant', parts: [{ type: 'text', text: 'Searching…' }, { type: 'tool_call', id: 'c1', name: 'crm__search_leads', input: { query: 'acme' } }] },
  { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c1', name: 'crm__search_leads', content: { ok: true, data: [] } }] },
  { role: 'user', parts: [{ type: 'text', text: 'thanks' }] },
];

describe('message mapping', () => {
  it('maps to Anthropic blocks with tool results in user turns', () => {
    const mapped = toAnthropicMessages(conversation);
    expect(mapped.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const toolTurn = mapped[2]?.content as Array<{ type: string }>;
    expect(toolTurn[0]?.type).toBe('tool_result');
    expect(toolTurn[1]?.type).toBe('text'); // merged consecutive user content
  });

  it('maps to OpenAI chat messages with tool_calls and tool role', () => {
    const mapped = toOpenAiMessages({ system: 'sys', messages: conversation });
    expect(mapped[0]).toEqual({ role: 'system', content: 'sys' });
    const assistant = mapped[2] as { role: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> };
    expect(assistant.role).toBe('assistant');
    expect(assistant.tool_calls?.[0]?.function.name).toBe('crm__search_leads');
    expect(JSON.parse(assistant.tool_calls?.[0]?.function.arguments ?? '{}')).toEqual({ query: 'acme' });
    expect((mapped[3] as { role: string }).role).toBe('tool');
  });
});

describe('factory and catalogue', () => {
  it('refuses the mock provider in production and without opt-in', () => {
    expect(() => createProvider('mock', {}, { nodeEnv: 'production', allowMock: true })).toThrow(AiProviderError);
    expect(() => createProvider('mock', {}, { nodeEnv: 'development', allowMock: false })).toThrow(AiProviderError);
    expect(createProvider('mock', {}, { nodeEnv: 'test' })).toBeInstanceOf(MockProvider);
  });

  it('requires API keys for real providers', () => {
    expect(() => createProvider('anthropic', {})).toThrow(/API key/);
    expect(() => createProvider('openai', {})).toThrow(/API key/);
    expect(createProvider('anthropic', { apiKey: 'sk-ant-test' }).kind).toBe('anthropic');
    expect(createProvider('openai', { apiKey: 'sk-test' }).kind).toBe('openai');
  });

  it('lists models per provider with capabilities', () => {
    expect(listModels('openai').some((m) => m.supportsEmbeddings)).toBe(true);
    expect(findModel('anthropic', 'claude-sonnet-4-5')?.supportsTools).toBe(true);
    expect(findModel('anthropic', 'nope')).toBeUndefined();
  });
});

describe('MockProvider', () => {
  it('streams text in chunks and finishes with a result', async () => {
    const provider = new MockProvider({ script: [{ text: 'hello world' }] });
    const deltas: string[] = [];
    let done = false;
    for await (const event of provider.stream({ model: 'mock-chat', messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }] })) {
      if (event.type === 'text_delta') deltas.push(event.delta);
      if (event.type === 'done') done = true;
    }
    expect(deltas.join('')).toBe('hello world');
    expect(done).toBe(true);
  });

  it('validates structured output against the schema', async () => {
    const provider = new MockProvider({ script: [{ structured: { score: 7 } }, { structured: { score: 'x' } }] });
    const schema = z.object({ score: z.number() });
    const ok = await provider.generateStructured({ model: 'mock-chat', messages: [], schema });
    expect(ok.data).toEqual({ score: 7 });
    await expect(provider.generateStructured({ model: 'mock-chat', messages: [], schema })).rejects.toThrow(/invalid/);
  });

  it('produces normalised deterministic embeddings', async () => {
    const provider = new MockProvider();
    const a = await provider.embed({ model: 'mock-embedding', input: ['hello', 'hello', 'other'] });
    expect(a.dimensions).toBe(64);
    expect(a.embeddings[0]).toEqual(a.embeddings[1]);
    expect(a.embeddings[0]).not.toEqual(a.embeddings[2]);
  });
});

describe('PricingTable', () => {
  it('estimates only known models and parses configuration safely', () => {
    const table = new PricingTable([{ provider: 'openai', model: 'gpt-4o-mini', inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 }]);
    expect(table.estimate('openai', 'gpt-4o-mini', { inputTokens: 1_000_000, outputTokens: 500_000 })).toBeCloseTo(0.45, 6);
    expect(table.estimate('openai', 'gpt-4o', { inputTokens: 10, outputTokens: 10 })).toBeNull();
    expect(PricingTable.fromJson('not json').error).not.toBeNull();
    expect(PricingTable.fromJson('[{"provider":"openai"}]').error).not.toBeNull();
    expect(PricingTable.fromJson(undefined).table.size()).toBe(0);
  });
});
