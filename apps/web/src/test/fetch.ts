import { vi } from 'vitest';

export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: RecordedCall) => Response | unknown | Promise<Response | unknown>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Stubs global fetch with `METHOD /api/v1/path` routes (prefix match on the path, exact on method).
 * Handlers return a Response or a plain value that is wrapped as `{ data }`. Unmatched calls fail loudly.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: RecordedCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '').split('?')[0] as string;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call: RecordedCall = { method, url, path, headers, body };
    calls.push(call);
    const key = Object.keys(routes)
      .filter((k) => {
        const [m, p] = k.split(' ') as [string, string];
        return m === method && (path === p || path.startsWith(`${p}/`) || path === p);
      })
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`Unmocked request: ${method} ${path}`);
    const out = await (routes[key] as Handler)(call);
    if (out instanceof Response) return out;
    // Plain values are wrapped as `{ data }`; objects that already are envelopes pass through.
    const isEnvelope = !!out && typeof out === 'object' && 'data' in out && 'meta' in out;
    return json(isEnvelope ? out : { data: out });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fetch: fn };
}

export function paginatedBody<T>(data: T[]) {
  return { data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } };
}

/** An SSE response whose chunks the test pushes by hand. */
export function controlledSse() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

export const sseEvent = (type: string, payload: Record<string, unknown> = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
