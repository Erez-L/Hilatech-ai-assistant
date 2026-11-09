import { REQUEST_ID_HEADER } from '@hilatech/contracts';
import { type Request, type Response } from 'express';

/** True when the client asked for `text/event-stream` (SSE) instead of a JSON response. */
export function wantsEventStream(req: Pick<Request, 'headers'>): boolean {
  const accept = req.headers.accept;
  const value = Array.isArray(accept) ? accept.join(',') : (accept ?? '');
  return value.toLowerCase().includes('text/event-stream');
}

export interface SseStream {
  /** Writes `event: <type>\ndata: <json>\n\n`. Silently ignored once the response ended. */
  send(event: { type: string } & Record<string, unknown>): void;
  end(): void;
  readonly closed: boolean;
}

/**
 * Switches an Express response to server-sent events: headers are flushed immediately so proxies and
 * browsers start reading, and every event is one `event`/`data` pair (the `type` field is duplicated as
 * the SSE event name so `EventSource.addEventListener(type)` works as well as `onmessage` parsing).
 */
export function openSse(res: Response, requestId?: string): SseStream {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (requestId && !res.getHeader(REQUEST_ID_HEADER)) res.setHeader(REQUEST_ID_HEADER, requestId);
  res.flushHeaders();

  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  return {
    get closed() {
      return closed || res.writableEnded;
    },
    send(event) {
      if (closed || res.writableEnded) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    },
    end() {
      if (!res.writableEnded) res.end();
    },
  };
}
