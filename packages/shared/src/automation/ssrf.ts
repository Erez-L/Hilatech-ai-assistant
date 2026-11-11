import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

/**
 * SSRF guard for every server-initiated HTTP request to a user-supplied URL (outbound webhooks,
 * workflow `http_request` steps, integration tests, n8n hand-offs).
 *
 * Rules:
 *  - only `https:` (and `http:` for loopback hosts when `allowLocalhost` is on, i.e. development/test);
 *  - the hostname is resolved by us and EVERY resolved address must be public; the connection is then pinned
 *    to that validated address (no second DNS lookup, so DNS rebinding cannot swap it afterwards);
 *  - private, loopback, link-local, CGNAT, multicast, reserved and documentation ranges are rejected for IPv4
 *    and IPv6 (including IPv4-mapped / NAT64 forms);
 *  - redirects are never followed;
 *  - hosts listed in `allowedHosts` (admin-controlled env allow-list, e.g. an in-cluster n8n) skip the range check.
 */
export class SsrfError extends Error {
  constructor(
    message: string,
    readonly reason: 'invalid_url' | 'scheme' | 'private_address' | 'dns' | 'credentials' | 'port',
  ) {
    super(message);
    this.name = 'SsrfError';
  }
}

export interface OutboundPolicy {
  /** Allow `http://` and loopback addresses for localhost-style hosts (development / tests only). */
  allowLocalhost?: boolean;
  /** Hostnames (lowercase, no port) that may resolve to private addresses. */
  allowedHosts?: readonly string[];
  /** Injectable resolver for tests. */
  resolve?: (hostname: string) => Promise<string[]>;
}

// ---------------------------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------------------------

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function inV4Block(n: number, base: string, bits: number): boolean {
  const b = ipv4ToNumber(base)!;
  const size = 2 ** (32 - bits);
  return n >= b && n < b + size;
}

export function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToNumber(ip);
  if (n === null) return true; // unparseable → treat as unsafe
  return V4_BLOCKS.some(([base, bits]) => inV4Block(n, base, bits));
}

/** Expands an IPv6 literal into 8 16-bit groups, or null when invalid. */
function parseIPv6(input: string): number[] | null {
  let ip = input;
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  // Embedded IPv4 tail (::ffff:1.2.3.4)
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToNumber(tail);
    if (v4 === null) return null;
    ip = `${ip.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...(halves.length === 2 ? Array(missing).fill('0') : []), ...rest];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

export function isPrivateIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const allZeroUntil5 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (allZeroUntil5 && g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: and ::1
  const embedded = `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
  if (allZeroUntil5 && g5 === 0xffff) return isPrivateIPv4(embedded); // ::ffff:a.b.c.d
  if (allZeroUntil5 && g5 === 0) return isPrivateIPv4(embedded); // ::a.b.c.d (deprecated IPv4-compatible)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPrivateIPv4(embedded); // NAT64
  }
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2001 && g1 === 0) return true; // Teredo
  if (g0 === 0x2002) return true; // 6to4 (can embed private v4)
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip.replace(/^\[|\]$/g, ''));
  const clean = ip.replace(/^\[|\]$/g, '');
  if (version === 4) return isPrivateIPv4(clean);
  if (version === 6) return isPrivateIPv6(clean);
  return true;
}

export function isLoopbackAddress(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '');
  if (isIP(clean) === 4) return clean.startsWith('127.');
  const g = parseIPv6(clean);
  if (!g) return false;
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  if (mapped) return g[6]! >> 8 === 127;
  return g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
}

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLocalhostName(hostname: string): boolean {
  return LOCALHOST_NAMES.has(hostname.toLowerCase());
}

// ---------------------------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------------------------

export interface SafeTarget {
  url: URL;
  /** Validated addresses the hostname resolved to (connect to the first). */
  addresses: string[];
}

function defaultResolve(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses.map((a) => a.address));
    });
  });
}

/** Synchronous URL-shape check (scheme, credentials, literal addresses). Throws `SsrfError`. */
export function assertSafeUrlShape(raw: string, policy: OutboundPolicy = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('Invalid URL', 'invalid_url');
  }
  if (url.username || url.password) {
    throw new SsrfError('URLs with embedded credentials are not allowed', 'credentials');
  }
  const host = url.hostname.toLowerCase();
  const localhost = Boolean(policy.allowLocalhost) && isLocalhostName(host);
  if (url.protocol === 'http:') {
    if (!localhost) throw new SsrfError('Only https:// URLs are allowed', 'scheme');
  } else if (url.protocol !== 'https:') {
    throw new SsrfError('Only https:// URLs are allowed', 'scheme');
  }
  const literal = host.replace(/^\[|\]$/g, '');
  if (isIP(literal) && isPrivateAddress(literal)) {
    const allowed = localhost || (policy.allowedHosts ?? []).includes(host);
    if (!allowed) throw new SsrfError('Target address is not allowed', 'private_address');
  }
  return url;
}

/** Validates the URL and resolves it, rejecting when ANY resolved address is non-public. */
export async function resolveSafeTarget(
  raw: string,
  policy: OutboundPolicy = {},
): Promise<SafeTarget> {
  const url = assertSafeUrlShape(raw, policy);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const hostAllowed = (policy.allowedHosts ?? []).includes(url.hostname.toLowerCase());
  const localhost = Boolean(policy.allowLocalhost) && isLocalhostName(url.hostname);

  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await (policy.resolve ?? defaultResolve)(host);
    } catch {
      throw new SsrfError(`Could not resolve host "${host}"`, 'dns');
    }
  }
  if (addresses.length === 0) throw new SsrfError(`Could not resolve host "${host}"`, 'dns');
  if (!hostAllowed) {
    for (const address of addresses) {
      if (isPrivateAddress(address) && !(localhost && isLoopbackAddress(address))) {
        throw new SsrfError('Target address is not allowed', 'private_address');
      }
    }
  }
  return { url, addresses };
}

// ---------------------------------------------------------------------------------------------
// Guarded request
// ---------------------------------------------------------------------------------------------

export interface SafeRequestOptions extends OutboundPolicy {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Response bytes kept (the rest is discarded). */
  maxResponseBytes?: number;
}

export interface SafeResponse {
  status: number;
  headers: Record<string, string>;
  /** UTF-8 body, truncated to `maxResponseBytes`. */
  body: string;
  truncated: boolean;
  durationMs: number;
}

/**
 * Performs one HTTP(S) request to a validated, DNS-pinned address. Never follows redirects. Throws
 * `SsrfError` for blocked targets, a plain `Error` (`name: 'TimeoutError' | 'NetworkError'`) for transport failures.
 */
export async function safeRequest(
  rawUrl: string,
  options: SafeRequestOptions = {},
): Promise<SafeResponse> {
  const target = await resolveSafeTarget(rawUrl, options);
  const { url } = target;
  const address = target.addresses[0]!;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxResponseBytes ?? 8 * 1024;
  const startedAt = Date.now();
  const isHttps = url.protocol === 'https:';
  const send = isHttps ? httpsRequest : httpRequest;
  const body = options.body;

  return new Promise<SafeResponse>((resolve, reject) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (
      body !== undefined &&
      !Object.keys(headers).some((h) => h.toLowerCase() === 'content-length')
    ) {
      headers['content-length'] = String(Buffer.byteLength(body));
    }
    const req = send(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: options.method ?? 'GET',
        headers,
        // Pin the connection to the address we validated; SNI / Host still use the original hostname.
        lookup: (_hostname, opts, cb) => {
          const family = isIP(address) === 6 ? 6 : 4;
          if (opts && (opts as { all?: boolean }).all) {
            (
              cb as unknown as (
                e: Error | null,
                a: Array<{ address: string; family: number }>,
              ) => void
            )(null, [{ address, family }]);
          } else {
            (cb as unknown as (e: Error | null, a: string, f: number) => void)(
              null,
              address,
              family,
            );
          }
        },
        servername: isHttps && !isIP(url.hostname) ? url.hostname : undefined,
        timeout: timeoutMs,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on('data', (chunk: Buffer) => {
          if (size >= maxBytes) {
            truncated = true;
            return;
          }
          const remaining = maxBytes - size;
          if (chunk.length > remaining) {
            chunks.push(chunk.subarray(0, remaining));
            size += remaining;
            truncated = true;
          } else {
            chunks.push(chunk);
            size += chunk.length;
          }
        });
        res.on('end', () => {
          const outHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) outHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: outHeaders,
            body: Buffer.concat(chunks).toString('utf8'),
            truncated,
            durationMs: Date.now() - startedAt,
          });
        });
        res.on('error', (e) =>
          reject(Object.assign(new Error(e.message), { name: 'NetworkError' })),
        );
      },
    );
    const deadline = setTimeout(() => {
      req.destroy(
        Object.assign(new Error(`Request timed out after ${timeoutMs}ms`), {
          name: 'TimeoutError',
        }),
      );
    }, timeoutMs);
    req.on('timeout', () => {
      req.destroy(
        Object.assign(new Error(`Request timed out after ${timeoutMs}ms`), {
          name: 'TimeoutError',
        }),
      );
    });
    req.on('error', (e) => {
      clearTimeout(deadline);
      reject(
        e.name === 'TimeoutError'
          ? e
          : Object.assign(new Error(e.message), { name: 'NetworkError' }),
      );
    });
    req.on('close', () => clearTimeout(deadline));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------------------------
// Guarded fetch (for SDKs that accept a `fetch` implementation)
// ---------------------------------------------------------------------------------------------

/**
 * Wraps `fetch` so every request first passes the SSRF policy (scheme, literal and DNS-resolved addresses)
 * and redirects are never followed (a public host must not be able to bounce the request to a private one).
 * Used for tenant-configurable endpoints reached through third-party SDKs (OpenAI/Anthropic `baseURL`).
 * Residual risk: the SDK re-resolves the hostname when it connects, so a DNS-rebinding attacker with a
 * very low TTL could still win the race; `safeRequest` (DNS-pinned) is used wherever the body is ours.
 */
export function createGuardedFetch(
  policy: OutboundPolicy = {},
  base: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  return async (input, init) => {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    await resolveSafeTarget(raw, policy);
    return base(input, { ...init, redirect: 'manual' });
  };
}
