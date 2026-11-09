import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AuthResponse } from '@hilatech/contracts';
import { ApiError, createApiClient, getErrorMessage, isApiError, type ApiClient } from '../client';

const AUTH: AuthResponse = {
  accessToken: 'new-token',
  expiresIn: 900,
  tokenType: 'Bearer',
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'noa@example.com',
    firstName: 'Noa',
    lastName: 'Levi',
    avatarUrl: null,
    emailVerifiedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  organizations: [],
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

interface Harness {
  client: ApiClient;
  fetch: ReturnType<typeof vi.fn>;
  token: { current: string | null };
  onUnauthorized: ReturnType<typeof vi.fn>;
  onRefreshed: ReturnType<typeof vi.fn>;
}

function harness(initialToken: string | null, orgId: string | null = 'org-1'): Harness {
  const token = { current: initialToken };
  const fetch = vi.fn();
  const onUnauthorized = vi.fn();
  const onRefreshed = vi.fn();
  const client = createApiClient({
    baseUrl: 'http://api.test/',
    fetch: fetch as unknown as typeof globalThis.fetch,
    getAccessToken: () => token.current,
    setAccessToken: (t) => {
      token.current = t;
    },
    getOrganizationId: () => orgId,
    onUnauthorized,
    onRefreshed,
  });
  return { client, fetch, token, onUnauthorized, onRefreshed };
}

function calledUrls(fetch: ReturnType<typeof vi.fn>): string[] {
  return fetch.mock.calls.map((c) => String(c[0]));
}

function headersOf(fetch: ReturnType<typeof vi.fn>, index: number): Record<string, string> {
  return (fetch.mock.calls[index]?.[1] as RequestInit).headers as Record<string, string>;
}

describe('createApiClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches bearer token, organization header and credentials, and unwraps the envelope', async () => {
    const h = harness('abc');
    h.fetch.mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));
    const result = await h.client.get<{ ok: boolean }>('/organizations/current', {
      query: { a: 1, skip: undefined },
    });
    expect(result).toEqual({ ok: true });
    expect(calledUrls(h.fetch)[0]).toBe('http://api.test/api/v1/organizations/current?a=1');
    const init = h.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('include');
    expect(headersOf(h.fetch, 0).Authorization).toBe('Bearer abc');
    expect(headersOf(h.fetch, 0)['x-organization-id']).toBe('org-1');
  });

  it('omits auth and organization headers when asked (public endpoints)', async () => {
    const h = harness('abc');
    h.fetch.mockResolvedValueOnce(jsonResponse({ data: { email: 'x@y.z' } }));
    await h.client.get('/invitations/preview', {
      query: { token: 't' },
      auth: false,
      organization: false,
    });
    const headers = headersOf(h.fetch, 0);
    expect(headers.Authorization).toBeUndefined();
    expect(headers['x-organization-id']).toBeUndefined();
  });

  it('refreshes once and retries the original request after a 401', async () => {
    const h = harness('stale');
    h.fetch
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'TOKEN_EXPIRED', message: 'expired' } }, { status: 401 }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: AUTH }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'm1' }] }));

    const result = await h.client.get<{ id: string }[]>('/members');
    expect(result).toEqual([{ id: 'm1' }]);
    const urls = calledUrls(h.fetch);
    expect(urls).toEqual([
      'http://api.test/api/v1/members',
      'http://api.test/api/v1/auth/refresh',
      'http://api.test/api/v1/members',
    ]);
    expect(headersOf(h.fetch, 2).Authorization).toBe('Bearer new-token');
    expect(h.token.current).toBe('new-token');
    expect(h.onRefreshed).toHaveBeenCalledWith(AUTH);
    expect(h.onUnauthorized).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent refreshes', async () => {
    const h = harness('stale');
    let resolveRefresh: (r: Response) => void = () => {};
    h.fetch.mockImplementation((url: string) => {
      if (url.endsWith('/auth/refresh'))
        return new Promise<Response>((res) => (resolveRefresh = res));
      const auth = (h.fetch.mock.calls.at(-1)?.[1] as RequestInit).headers as Record<
        string,
        string
      >;
      if (auth.Authorization === 'Bearer stale') {
        return Promise.resolve(
          jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'no' } }, { status: 401 }),
        );
      }
      return Promise.resolve(jsonResponse({ data: url.endsWith('/roles') ? 'roles' : 'members' }));
    });

    const a = h.client.get<string>('/members');
    const b = h.client.get<string>('/roles');
    // Let both initial requests fail and both reach the refresh path.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    resolveRefresh(jsonResponse({ data: AUTH }));

    expect(await a).toBe('members');
    expect(await b).toBe('roles');
    const refreshCalls = calledUrls(h.fetch).filter((u) => u.endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('signals logout when the refresh fails and does not retry', async () => {
    const h = harness('stale');
    h.fetch
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'TOKEN_EXPIRED', message: 'expired' } }, { status: 401 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'TOKEN_INVALID', message: 'gone' } }, { status: 401 }),
      );

    await expect(h.client.get('/members')).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_EXPIRED',
    });
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.token.current).toBeNull();
    expect(h.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('tries the cookie first when there is no token in memory', async () => {
    const h = harness(null);
    h.fetch
      .mockResolvedValueOnce(jsonResponse({ data: AUTH }))
      .mockResolvedValueOnce(jsonResponse({ data: { me: 1 } }));
    const me = await h.client.get<{ me: number }>('/auth/me');
    expect(me).toEqual({ me: 1 });
    expect(calledUrls(h.fetch)[0]).toBe('http://api.test/api/v1/auth/refresh');
    expect(headersOf(h.fetch, 1).Authorization).toBe('Bearer new-token');
  });

  it('throws without a network call when there is no token and no cookie', async () => {
    const h = harness(null);
    h.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(h.client.get('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(h.fetch).toHaveBeenCalledTimes(1); // only the refresh attempt
    expect(h.onUnauthorized).toHaveBeenCalled();
  });

  it('maps error envelopes to ApiError with code, details and requestId', async () => {
    const h = harness('abc');
    h.fetch.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input',
            details: [{ path: ['email'], message: 'Invalid email' }],
            requestId: 'req_123',
          },
        },
        { status: 400 },
      ),
    );
    const error = await h.client.post('/auth/register', { email: 'x' }).catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    const apiError = error as ApiError;
    expect(apiError.isValidation).toBe(true);
    expect(apiError.requestId).toBe('req_123');
    expect(apiError.details).toEqual([{ path: ['email'], message: 'Invalid email' }]);
    expect(getErrorMessage(apiError)).toBe('Invalid input');
  });

  it('falls back to status-based errors for non-JSON bodies and handles 204', async () => {
    const h = harness('abc');
    h.fetch.mockResolvedValueOnce(new Response('<html>gateway</html>', { status: 503 }));
    await expect(h.client.get('/health')).rejects.toMatchObject({
      status: 503,
      code: 'INTERNAL_ERROR',
    });

    h.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(h.client.delete('/members/1')).resolves.toBeUndefined();
  });

  it('wraps network failures in a status-0 ApiError', async () => {
    const h = harness('abc');
    h.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = await h.client.get('/members').catch((e: unknown) => e);
    expect(isApiError(error)).toBe(true);
    expect((error as ApiError).status).toBe(0);
    expect(getErrorMessage(error)).toMatch(/could not be reached/);
  });

  it('normalises list responses with pagination meta', async () => {
    const h = harness('abc');
    h.fetch.mockResolvedValueOnce(
      jsonResponse({ data: [1, 2], meta: { page: 2, pageSize: 2, total: 5, totalPages: 3 } }),
    );
    const result = await h.client.list<number>('/audit-logs', { page: 2, pageSize: 2 });
    expect(result.data).toEqual([1, 2]);
    expect(result.meta).toEqual({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
  });
});

describe('response normalisers', () => {
  it('normalizeDashboard accepts nested and flat shapes', async () => {
    const { normalizeDashboard } = await import('../analytics');
    expect(
      normalizeDashboard({
        generatedAt: '2026-11-09T00:00:00.000Z',
        members: { active: 3, suspended: 1 },
        invitations: { pending: 2 },
        contacts: { total: 10 },
        leads: { total: 4, byStatus: { new: 3, won: 1 } },
        conversations: { total: 7, open: 2 },
      }),
    ).toEqual({
      members: 3,
      suspendedMembers: 1,
      pendingInvitations: 2,
      contacts: 10,
      leads: 4,
      leadsByStatus: { new: 3, won: 1 },
      conversations: 7,
      openConversations: 2,
      generatedAt: '2026-11-09T00:00:00.000Z',
    });
    expect(
      normalizeDashboard({
        members: 2,
        pendingInvitations: 0,
        leads: 1,
        contacts: 1,
        conversations: 5,
        openConversations: 1,
      }),
    ).toMatchObject({
      members: 2,
      leads: 1,
      contacts: 1,
      conversations: 5,
      openConversations: 1,
      pendingInvitations: 0,
    });
  });

  it('normalizePlans accepts arrays and records', async () => {
    const { normalizePlans } = await import('../billing');
    const limits = {
      seats: 2,
      aiTokensPerMonth: 1,
      agents: 1,
      knowledgeDocuments: 1,
      storageMb: 1,
      automations: 1,
    };
    expect(normalizePlans([{ key: 'free', limits }])).toEqual({ free: limits });
    expect(normalizePlans({ pro: limits })).toEqual({ pro: limits });
  });
});
