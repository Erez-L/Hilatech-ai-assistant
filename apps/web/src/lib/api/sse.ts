import { assistantStreamEventSchema, type AssistantStreamEvent } from '@hilatech/contracts';
import { api, ApiError, type RequestOptions } from './client';

export interface RawSseEvent {
  event: string;
  data: string;
}

/**
 * Incremental parser for `text/event-stream`. Feed decoded text chunks of any size (events may be
 * split anywhere, including inside a UTF-8 sequence handled by the caller's TextDecoder stream);
 * complete events are returned as they finish. Supports CRLF, comments and multi-line `data:`.
 */
export function createSseParser() {
  let buffer = '';
  let event = '';
  let data: string[] = [];

  const flush = (out: RawSseEvent[]) => {
    if (data.length > 0 || event) out.push({ event: event || 'message', data: data.join('\n') });
    event = '';
    data = [];
  };

  return {
    push(chunk: string): RawSseEvent[] {
      buffer += chunk;
      const out: RawSseEvent[] = [];
      let idx: number;
      while ((idx = buffer.search(/\r\n|\n|\r/)) !== -1) {
        const lineEnd = buffer[idx] === '\r' && buffer[idx + 1] === '\n' ? 2 : 1;
        // A lone trailing "\r" might be the first half of "\r\n": wait for more input.
        if (buffer[idx] === '\r' && idx + 1 >= buffer.length) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + lineEnd);
        if (line === '') flush(out);
        else if (line.startsWith(':')) continue;
        else {
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          let value = colon === -1 ? '' : line.slice(colon + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
        }
      }
      return out;
    },
    /** Emits a final event when the stream ended without a trailing blank line. */
    end(): RawSseEvent[] {
      const out: RawSseEvent[] = [];
      if (buffer) {
        this.push('\n');
      }
      flush(out);
      return out;
    },
  };
}

/** Parses a raw SSE event into a validated assistant stream event (null when unknown/invalid). */
export function parseAssistantEvent(raw: RawSseEvent): AssistantStreamEvent | null {
  try {
    const json = JSON.parse(raw.data) as Record<string, unknown>;
    const parsed = assistantStreamEventSchema.safeParse({ type: raw.event, ...json });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * POST with `Accept: text/event-stream` through the shared API client (auth, organization header and
 * refresh included) and yields the parsed events. Non-2xx responses throw `ApiError` before any event.
 */
export async function* streamSse(
  path: string,
  body: unknown,
  options: Pick<RequestOptions, 'signal'> = {},
): AsyncGenerator<RawSseEvent, void, void> {
  const res = await api.fetchRaw(path, {
    method: 'POST',
    body,
    signal: options.signal,
    headers: { Accept: 'text/event-stream' },
  });
  if (!res.body) {
    throw new ApiError({
      status: res.status,
      code: 'STREAM_UNAVAILABLE',
      message: 'The server did not return a stream.',
    });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) yield ev;
    }
    for (const ev of parser.push(decoder.decode())) yield ev;
    for (const ev of parser.end()) yield ev;
  } finally {
    reader.releaseLock();
  }
}
