import { rowsToHistory, transcriptToRows, parseToolCalls } from './assistant.mappers';

const t = (n: number) => new Date(1_700_000_000_000 + n);
const base = { toolCalls: null, toolCallId: null, toolName: null, metadata: {} } as const;

describe('rowsToHistory', () => {
  it('maps user, assistant (text + tool calls) and tool rows, skipping system rows', () => {
    const { messages } = rowsToHistory([
      { ...base, role: 'system', content: 'ignored', createdAt: t(0) },
      { ...base, role: 'user', content: 'when?', createdAt: t(1) },
      {
        ...base,
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'time.now', input: {} }],
        createdAt: t(2),
      },
      {
        ...base,
        role: 'tool',
        content: '{"ok":true}',
        toolCallId: 'c1',
        toolName: 'time.now',
        createdAt: t(3),
      },
      { ...base, role: 'assistant', content: 'now', createdAt: t(4) },
    ]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(messages[1]!.parts).toEqual([
      { type: 'tool_call', id: 'c1', name: 'time__now', input: {} },
    ]);
    expect(messages[2]!.parts[0]).toMatchObject({
      type: 'tool_result',
      toolCallId: 'c1',
      name: 'time__now',
      content: { ok: true },
    });
  });

  it('merges parallel tool results into one tool message', () => {
    const { messages } = rowsToHistory([
      { ...base, role: 'user', content: 'q', createdAt: t(0) },
      {
        ...base,
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', name: 'time.now', input: {} },
          { id: 'b', name: 'time.now', input: {} },
        ],
        createdAt: t(1),
      },
      {
        ...base,
        role: 'tool',
        content: 'x',
        toolCallId: 'a',
        toolName: 'time.now',
        createdAt: t(2),
      },
      {
        ...base,
        role: 'tool',
        content: 'y',
        toolCallId: 'b',
        toolName: 'time.now',
        createdAt: t(3),
      },
    ]);
    expect(messages).toHaveLength(3);
    expect(messages[2]!.parts).toHaveLength(2);
  });

  it('repairs orphan tool results and unanswered tool calls', () => {
    const { messages } = rowsToHistory([
      {
        ...base,
        role: 'tool',
        content: 'x',
        toolCallId: 'zz',
        toolName: 'time.now',
        createdAt: t(0),
      },
      { ...base, role: 'user', content: 'q', createdAt: t(1) },
      {
        ...base,
        role: 'assistant',
        content: 'partial',
        toolCalls: [{ id: 'lost', name: 'time.now', input: {} }],
        createdAt: t(2),
      },
    ]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1]!.parts).toEqual([{ type: 'text', text: 'partial' }]);
  });

  it('ignores malformed stored tool calls', () => {
    expect(parseToolCalls([{ nope: 1 }])).toBeNull();
    expect(parseToolCalls(null)).toBeNull();
  });
});

describe('transcriptToRows', () => {
  const result = {
    status: 'succeeded' as const,
    usage: { inputTokens: 10, outputTokens: 4 },
    durationMs: 5,
    estimatedCostUsd: null,
    stepCount: 3,
  };

  it('skips the user message, restores dotted tool keys and puts token totals on the final assistant row', () => {
    const rows = transcriptToRows(
      [
        { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          parts: [
            { type: 'tool_call', id: 'c1', name: 'crm__search_leads', input: { query: 'x' } },
          ],
        },
        {
          role: 'tool',
          parts: [
            {
              type: 'tool_result',
              toolCallId: 'c1',
              name: 'crm__search_leads',
              content: { ok: true },
              isError: false,
            },
          ],
        },
        { role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
      ],
      result,
    );
    expect(rows.map((r) => r.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(rows[0]).toMatchObject({
      toolCalls: [{ id: 'c1', name: 'crm.search_leads', input: { query: 'x' } }],
      inputTokens: null,
    });
    expect(rows[1]).toMatchObject({
      toolCallId: 'c1',
      toolName: 'crm.search_leads',
      content: '{"ok":true}',
    });
    expect(rows[2]).toMatchObject({ content: 'done', inputTokens: 10, outputTokens: 4 });
  });
});
