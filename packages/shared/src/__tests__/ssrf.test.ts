import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  SsrfError,
  createGuardedFetch,
  assertSafeUrlShape,
  isPrivateAddress,
  resolveSafeTarget,
  safeRequest,
} from '../automation/ssrf';

describe('isPrivateAddress', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    '2001:db8::1',
    'not-an-ip',
  ])('%s is private/unsafe', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s is public',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('assertSafeUrlShape', () => {
  it('requires https', () => {
    expect(() => assertSafeUrlShape('http://example.com/x')).toThrow(SsrfError);
    expect(() => assertSafeUrlShape('ftp://example.com')).toThrow(SsrfError);
    expect(assertSafeUrlShape('https://example.com/x').hostname).toBe('example.com');
  });
  it('allows http only for localhost when allowLocalhost is on', () => {
    expect(() => assertSafeUrlShape('http://localhost:3000/x')).toThrow(SsrfError);
    expect(assertSafeUrlShape('http://localhost:3000/x', { allowLocalhost: true }).port).toBe('3000');
    expect(() => assertSafeUrlShape('http://example.com', { allowLocalhost: true })).toThrow(SsrfError);
    expect(() => assertSafeUrlShape('http://10.0.0.1', { allowLocalhost: true })).toThrow(SsrfError);
  });
  it('rejects literal private IPs, including obfuscated numeric forms', () => {
    for (const u of [
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://169.254.169.254/latest/meta-data',
      'https://2130706433/', // decimal 127.0.0.1
      'https://0x7f.1/', // hex form normalised by WHATWG URL
      'https://[::ffff:192.168.0.1]/',
    ]) {
      expect(() => assertSafeUrlShape(u)).toThrow(SsrfError);
    }
  });
  it('rejects embedded credentials', () => {
    expect(() => assertSafeUrlShape('https://user:pw@example.com')).toThrow(/credentials/);
  });
});

describe('resolveSafeTarget (DNS)', () => {
  it('rejects a public-looking hostname that resolves to a private address', async () => {
    await expect(
      resolveSafeTarget('https://evil.example.com/', { resolve: async () => ['10.0.0.5'] }),
    ).rejects.toMatchObject({ reason: 'private_address' });
  });
  it('rejects when ANY of several records is private (rebinding mix)', async () => {
    await expect(
      resolveSafeTarget('https://evil.example.com/', { resolve: async () => ['8.8.8.8', '169.254.169.254'] }),
    ).rejects.toBeInstanceOf(SsrfError);
  });
  it('accepts a hostname resolving to public addresses', async () => {
    const t = await resolveSafeTarget('https://ok.example.com/p', { resolve: async () => ['93.184.216.34'] });
    expect(t.addresses).toEqual(['93.184.216.34']);
  });
  it('reports DNS failures', async () => {
    await expect(
      resolveSafeTarget('https://nx.example.com/', {
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toMatchObject({ reason: 'dns' });
  });
  it('honours the admin allow-list for private hosts', async () => {
    const t = await resolveSafeTarget('https://n8n.internal/', {
      resolve: async () => ['10.0.0.9'],
      allowedHosts: ['n8n.internal'],
    });
    expect(t.addresses).toEqual(['10.0.0.9']);
  });
  it('allows loopback names only with allowLocalhost', async () => {
    await expect(resolveSafeTarget('http://localhost:1/')).rejects.toBeInstanceOf(SsrfError);
    await expect(resolveSafeTarget('http://localhost:1/', { allowLocalhost: true })).resolves.toBeDefined();
  });
});

describe('safeRequest', () => {
  it('talks to a local server in dev mode, truncates the response and never follows redirects', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/' });
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`echo:${body}:` + 'x'.repeat(5000));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await safeRequest(`http://localhost:${port}/a`, {
        method: 'POST',
        body: 'hi',
        allowLocalhost: true,
        maxResponseBytes: 100,
      });
      expect(res.status).toBe(200);
      expect(res.body.startsWith('echo:hi:')).toBe(true);
      expect(res.body.length).toBe(100);
      expect(res.truncated).toBe(true);

      const redirect = await safeRequest(`http://localhost:${port}/redirect`, { allowLocalhost: true });
      expect(redirect.status).toBe(302);

      await expect(safeRequest(`http://localhost:${port}/a`, {})).rejects.toBeInstanceOf(SsrfError);
    } finally {
      server.close();
    }
  });

  it('times out slow servers', async () => {
    const server = createServer(() => {
      /* never respond */
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        safeRequest(`http://localhost:${port}/`, { allowLocalhost: true, timeoutMs: 150 }),
      ).rejects.toMatchObject({ name: 'TimeoutError' });
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});

describe('SEC-01: createGuardedFetch', () => {
  it('blocks private targets before any network call and never follows redirects', async () => {
    const calls: Array<{ url: string; redirect?: string }> = [];
    const base = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), redirect: init?.redirect });
      return new Response('ok');
    }) as typeof fetch;
    const guarded = createGuardedFetch(
      { resolve: async (host) => (host === 'rebind.example' ? ['10.0.0.7'] : ['93.184.216.34']) },
      base,
    );
    await expect(guarded('http://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(SsrfError);
    await expect(guarded('https://rebind.example/v1')).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toHaveLength(0);
    await guarded('https://api.example.com/v1/chat');
    expect(calls).toEqual([{ url: 'https://api.example.com/v1/chat', redirect: 'manual' }]);
  });
});
