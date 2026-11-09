import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage } from '@hilatech/contracts';
import { paginated, renderWithProviders, seedSession } from '@/test/render';
import { controlledSse, mockApi, sseEvent } from '@/test/fetch';
import { ChatPane, foldMessages } from '../chat-pane';

const THREAD = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-11-09T10:00:00.000Z';

function message(over: Partial<AssistantMessage>): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    threadId: THREAD,
    role: 'user',
    content: '',
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    inputTokens: null,
    outputTokens: null,
    metadata: {},
    createdAt: NOW,
    ...over,
  };
}

describe('ChatPane', () => {
  beforeEach(() => seedSession(['ai:assistant:use']));
  afterEach(() => vi.unstubAllGlobals());

  it('streams the answer as it arrives, locks the composer meanwhile and shows the persisted reply', async () => {
    const sse = controlledSse();
    let persisted: AssistantMessage[] = [];
    const { calls } = mockApi({
      'GET /assistant/threads': () => paginated([]),
      'GET /assistant/threads/:id/messages': () => paginated([]),
      [`GET /assistant/threads/${THREAD}/messages`]: () => paginated(persisted),
      [`POST /assistant/threads/${THREAD}/messages`]: () => sse.response,
    });
    renderWithProviders(<ChatPane threadId={THREAD} context={{}} onBack={() => {}} />);
    const box = await screen.findByRole('textbox', { name: 'Message the assistant' });

    // Shift+Enter inserts a newline, Enter sends.
    await userEvent.type(box, 'hello{Shift>}{Enter}{/Shift}there');
    expect(box).toHaveValue('hello\nthere');
    await userEvent.type(box, '{Enter}');

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ content: 'hello\nthere' }),
    );
    expect(calls.find((c) => c.method === 'POST')?.headers.Accept).toBe('text/event-stream');
    // The user's message shows at once and the composer is locked while streaming.
    expect(await screen.findByText(/hello\s+there/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Message the assistant' })).toBeDisabled(),
    );

    sse.push(sseEvent('message_start', { messageId: THREAD }));
    sse.push(sseEvent('text_delta', { delta: 'mock: hel' }));
    expect(await screen.findByText('mock: hel')).toBeInTheDocument();
    sse.push(sseEvent('tool_call', { toolCall: { id: 'c1', name: 'time.now', input: {} } }));
    expect(
      await screen.findByRole('button', { name: /Tool time\.now: Running/ }),
    ).toBeInTheDocument();
    sse.push(
      sseEvent('tool_result', {
        toolCallId: 'c1',
        name: 'time.now',
        ok: true,
        summary: 'Returned the time',
      }),
    );
    expect(await screen.findByRole('button', { name: /Tool time\.now: OK/ })).toBeInTheDocument();
    sse.push(sseEvent('text_delta', { delta: 'lo there' }));
    expect(await screen.findByText('mock: hello there')).toBeInTheDocument();

    // After message_end the persisted list replaces the live turn.
    const reply = message({
      role: 'assistant',
      content: 'mock: hello there',
      inputTokens: 12,
      outputTokens: 5,
    });
    persisted = [message({ content: 'hello\nthere' }), reply];
    sse.push(
      sseEvent('message_end', { message: reply, usage: { inputTokens: 12, outputTokens: 5 } }),
    );
    sse.close();
    expect(await screen.findByText('12 in · 5 out tokens')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Message the assistant' })).toBeEnabled(),
    );
    expect(screen.getAllByText('mock: hello there')).toHaveLength(1);
  });

  it('shows a link to Settings → AI when the server answers 409 AI_NOT_CONFIGURED', async () => {
    seedSession(['ai:assistant:use', 'ai:config:manage']);
    mockApi({
      'GET /assistant/threads': () => paginated([]),
      [`GET /assistant/threads/${THREAD}/messages`]: () => paginated([]),
      [`POST /assistant/threads/${THREAD}/messages`]: () =>
        new Response(JSON.stringify({ error: { code: 'AI_NOT_CONFIGURED', message: 'none' } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    renderWithProviders(<ChatPane threadId={THREAD} context={{}} onBack={() => {}} />);
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Message the assistant' }),
      'hi{Enter}',
    );
    const link = await screen.findByRole('link', { name: /Open Settings/ });
    expect(link).toHaveAttribute('href', '/settings/ai');
  });

  it('explains a 402 BUDGET_EXCEEDED and links to billing', async () => {
    seedSession(['ai:assistant:use', 'organization:billing:manage']);
    mockApi({
      'GET /assistant/threads': () => paginated([]),
      [`GET /assistant/threads/${THREAD}/messages`]: () => paginated([]),
      [`POST /assistant/threads/${THREAD}/messages`]: () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'BUDGET_EXCEEDED',
              message: 'This request would exceed the monthly AI token budget.',
              details: { scope: 'budget_tokens', reason: 'would_exceed', used: 900, budget: 1000 },
            },
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        ),
    });
    renderWithProviders(<ChatPane threadId={THREAD} context={{}} onBack={() => {}} />);
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Message the assistant' }),
      'hi{Enter}',
    );
    const alert = await screen.findByTestId('budget-exceeded');
    expect(alert).toHaveTextContent('Monthly AI budget reached');
    expect(alert).toHaveTextContent('would go over');
    expect(alert).toHaveTextContent('900 of 1,000');
    expect(screen.getByRole('link', { name: /Review budget in Billing/ })).toHaveAttribute(
      'href',
      '/settings/billing',
    );
    // The generic "couldn't answer" alert is not shown in addition.
    expect(screen.queryByText('The assistant couldn’t answer')).toBeNull();
  });

  it('passes the page context with the message', async () => {
    seedSession(['ai:assistant:use']);
    const sse = controlledSse();
    const { calls } = mockApi({
      'GET /assistant/threads': () => paginated([]),
      [`GET /assistant/threads/${THREAD}/messages`]: () => paginated([]),
      [`POST /assistant/threads/${THREAD}/messages`]: () => sse.response,
    });
    const leadId = '44444444-4444-4444-8444-444444444444';
    renderWithProviders(<ChatPane threadId={THREAD} context={{ leadId }} onBack={() => {}} />);
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Message the assistant' }),
      'summarise{Enter}',
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      content: 'summarise',
      context: { leadId },
    });
    sse.close();
  });
});

describe('foldMessages', () => {
  it('pairs tool calls with their results and hides raw tool rows', () => {
    const call = { id: 'c1', name: 'leads.search', input: { q: 'acme' } };
    const items = foldMessages([
      message({ role: 'user', content: 'find acme' }),
      message({ role: 'assistant', content: '', toolCalls: [call] }),
      message({
        role: 'tool',
        toolCallId: 'c1',
        toolName: 'leads.search',
        content: '{"status":"denied"}',
      }),
      message({ role: 'assistant', content: 'I could not.' }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'assistant']);
    const first = items[1] as Extract<(typeof items)[number], { kind: 'assistant' }>;
    expect(first.tools[0]).toMatchObject({ name: 'leads.search', outcome: 'denied' });
  });
});
