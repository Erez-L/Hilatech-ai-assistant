import { beforeEach, describe, expect, it } from 'vitest';
import { seedSession } from '@/test/render';
import { controlledSse, mockApi, sseEvent } from '@/test/fetch';
import { createSseParser, parseAssistantEvent, streamSse } from '../sse';

describe('createSseParser', () => {
  it('parses events split across arbitrary chunks', () => {
    const parser = createSseParser();
    const text = 'event: text_delta\ndata: {"a":1}\n\nevent: message_end\ndata: {"b":2}\n\n';
    const events = [];
    for (const ch of text) events.push(...parser.push(ch));
    expect(events).toEqual([
      { event: 'text_delta', data: '{"a":1}' },
      { event: 'message_end', data: '{"b":2}' },
    ]);
  });

  it('handles CRLF, comments, multi-line data and a missing trailing blank line', () => {
    const parser = createSseParser();
    const first = parser.push(
      ': keep-alive\r\nevent: x\r\ndata: one\r\ndata: two\r\n\r\ndata: tail\r\n',
    );
    expect(first).toEqual([{ event: 'x', data: 'one\ntwo' }]);
    expect(parser.end()).toEqual([{ event: 'message', data: 'tail' }]);
  });

  it('keeps a half-received CRLF pair together', () => {
    const parser = createSseParser();
    expect(parser.push('event: a\r')).toEqual([]);
    expect(parser.push('\ndata: z\r\n\r')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'a', data: 'z' }]);
  });
});

describe('parseAssistantEvent', () => {
  it('validates against the contract and drops unknown events', () => {
    expect(
      parseAssistantEvent({ event: 'text_delta', data: '{"type":"text_delta","delta":"hi"}' }),
    ).toEqual({
      type: 'text_delta',
      delta: 'hi',
    });
    expect(parseAssistantEvent({ event: 'text_delta', data: '{"delta":5}' })).toBeNull();
    expect(parseAssistantEvent({ event: 'nope', data: '{}' })).toBeNull();
    expect(parseAssistantEvent({ event: 'text_delta', data: 'not json' })).toBeNull();
  });
});

describe('streamSse', () => {
  beforeEach(() => seedSession(['ai:assistant:use']));

  it('posts with the shared auth, organization and SSE headers and yields chunked events', async () => {
    const sse = controlledSse();
    const { calls } = mockApi({ 'POST /assistant/threads/t1/messages': () => sse.response });
    const received: string[] = [];
    const run = (async () => {
      for await (const ev of streamSse('/assistant/threads/t1/messages', { content: 'hi' })) {
        received.push(ev.event);
      }
    })();
    const payload = sseEvent('text_delta', { delta: 'Hel' });
    sse.push(payload.slice(0, 12));
    sse.push(payload.slice(12));
    sse.push(sseEvent('text_delta', { delta: 'lo' }));
    sse.close();
    await run;
    expect(received).toEqual(['text_delta', 'text_delta']);
    const call = calls[0]!;
    expect(call.headers.Accept).toBe('text/event-stream');
    expect(call.headers.Authorization).toBe('Bearer tok');
    expect(call.headers['x-organization-id']).toBe('22222222-2222-4222-8222-222222222222');
    expect(call.body).toEqual({ content: 'hi' });
  });

  it('throws an ApiError with the server code before any event (409 AI_NOT_CONFIGURED)', async () => {
    mockApi({
      'POST /assistant/threads/t1/messages': () =>
        new Response(
          JSON.stringify({ error: { code: 'AI_NOT_CONFIGURED', message: 'No provider' } }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    });
    const iterate = async () => {
      for await (const ev of streamSse('/assistant/threads/t1/messages', { content: 'x' })) void ev;
    };
    await expect(iterate()).rejects.toMatchObject({ status: 409, code: 'AI_NOT_CONFIGURED' });
  });
});
