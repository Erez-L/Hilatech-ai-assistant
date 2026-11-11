import {
  API_PREFIX,
  ErrorCode,
  ORGANIZATION_HEADER,
  type ApiSuccess,
  type AuthResponse,
  type PaginationMeta,
} from '@hilatech/contracts';
import { env } from '@/lib/env';
import { useSession } from '@/stores/session';
import { activeT, translateActive } from '@/i18n/active';
import { vm } from '@/i18n/validation';
import type { MessageKey } from '@/i18n/messages';

/** Error surfaced to the UI for any non-2xx response (or network failure). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.requestId = input.requestId;
  }

  get isValidation(): boolean {
    return this.code === ErrorCode.VALIDATION_ERROR;
  }

  get isNotFound(): boolean {
    return this.status === 404 || this.code === ErrorCode.NOT_FOUND;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Error codes whose server text is generic; the UI shows its own translated message instead. */
const LOCALIZED_CODES = new Set([
  'NETWORK_ERROR',
  'STREAM_UNAVAILABLE',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'TOKEN_REUSED',
  'FORBIDDEN',
  'EMAIL_NOT_VERIFIED',
  'ORGANIZATION_REQUIRED',
  'NOT_A_MEMBER',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'PAYMENT_NOT_CONFIGURED',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_ERROR',
  'AI_NOT_CONFIGURED',
  'AI_PROVIDER_ERROR',
  'INTERNAL_ERROR',
]);

/**
 * Human-readable, translated message for any thrown value. Known error codes map to `errors.<CODE>`;
 * other API messages (conflicts, limits) are the server's own text, translated when it matches a known one.
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
  const fb = fallback ?? activeT('errors.generic');
  if (isApiError(error)) {
    if (LOCALIZED_CODES.has(error.code)) return activeT(`errors.${error.code}` as MessageKey);
    if (error.status === 0) return activeT('errors.NETWORK_ERROR');
    return error.message ? translateActive(error.message) : fb;
  }
  if (error instanceof Error && error.message) return translateActive(error.message);
  return fb;
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  /** Attach the bearer token (default true). Public endpoints pass false. */
  auth?: boolean;
  /** Attach the organization header (default true when an organization is active). */
  organization?: boolean;
  /** On 401, refresh once and retry (default true). */
  retryOnUnauthorized?: boolean;
  headers?: Record<string, string>;
}

export interface ApiListResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ApiClientConfig {
  baseUrl: string;
  fetch?: typeof fetch;
  getAccessToken: () => string | null;
  setAccessToken: (token: string | null) => void;
  getOrganizationId: () => string | null;
  /** Called when a refresh fails: the session is gone and the UI should sign out. */
  onUnauthorized?: () => void;
  /** Called with the full auth payload after a successful refresh. */
  onRefreshed?: (auth: AuthResponse) => void;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<ApiSuccess<T>>;
  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  post<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  put<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  delete<T = void>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  list<T>(
    path: string,
    query?: QueryParams,
    options?: Omit<RequestOptions, 'method' | 'body' | 'query'>,
  ): Promise<ApiListResult<T>>;
  /**
   * Authenticated fetch that returns the raw successful `Response` (for streaming bodies). Shares the
   * token, organization header and one-shot refresh/retry logic with `request`; non-2xx → ApiError.
   */
  fetchRaw(path: string, options?: RequestOptions): Promise<Response>;
  /** POST /auth/refresh using the httpOnly cookie. Deduplicates concurrent calls. Returns null when the session is gone. */
  refresh(): Promise<AuthResponse | null>;
}

function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function toApiError(res: Response): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Non-JSON error body (proxy, gateway). Fall through to a status-based error.
  }
  const error =
    payload && typeof payload === 'object' && 'error' in payload
      ? ((payload as { error: Record<string, unknown> }).error ?? null)
      : null;
  const code = typeof error?.code === 'string' ? error.code : defaultCodeForStatus(res.status);
  const message =
    typeof error?.message === 'string' && error.message
      ? error.message
      : defaultMessageForStatus(res.status);
  if (code === ErrorCode.EMAIL_NOT_VERIFIED) {
    // The server enforces email verification: switch the app to the verification gate.
    useSession.getState().setEmailVerificationRequired(true);
  }
  return new ApiError({
    status: res.status,
    code,
    message,
    details: error?.details,
    requestId:
      typeof error?.requestId === 'string'
        ? error.requestId
        : (res.headers.get('x-request-id') ?? undefined),
  });
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return ErrorCode.VALIDATION_ERROR;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMITED;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}

function defaultMessageForStatus(status: number): string {
  switch (status) {
    case 401:
      return vm('errors.UNAUTHORIZED');
    case 403:
      return vm('errors.FORBIDDEN');
    case 404:
      return vm('errors.NOT_FOUND');
    case 409:
      return vm('errors.CONFLICT');
    case 429:
      return vm('errors.RATE_LIMITED');
    default:
      return status >= 500 ? vm('errors.INTERNAL_ERROR') : vm('errors.requestFailed');
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const fetchImpl: typeof fetch = config.fetch ?? ((...args) => globalThis.fetch(...args));
  const baseUrl = `${config.baseUrl.replace(/\/+$/, '')}${API_PREFIX}`;
  let refreshPromise: Promise<AuthResponse | null> | null = null;

  const refresh = (): Promise<AuthResponse | null> => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const res = await fetchImpl(`${baseUrl}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          config.setAccessToken(null);
          return null;
        }
        const json = (await res.json()) as ApiSuccess<AuthResponse>;
        config.setAccessToken(json.data.accessToken);
        config.onRefreshed?.(json.data);
        return json.data;
      } catch {
        config.setAccessToken(null);
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  };

  const fetchRaw = async (path: string, options: RequestOptions = {}): Promise<Response> => {
    const {
      method = 'GET',
      body,
      query,
      signal,
      auth = true,
      organization = true,
      retryOnUnauthorized = true,
      headers: extraHeaders,
    } = options;
    const url = buildUrl(baseUrl, path, query);

    const perform = async (token: string | null): Promise<Response> => {
      const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
      // FormData bodies (uploads) get their multipart Content-Type (with boundary) from the browser.
      const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
      if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
      if (token) headers.Authorization = `Bearer ${token}`;
      const orgId = organization ? config.getOrganizationId() : null;
      if (orgId) headers[ORGANIZATION_HEADER] = orgId;
      try {
        return await fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
          credentials: 'include',
          signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw new ApiError({
          status: 0,
          code: 'NETWORK_ERROR',
          message: vm('errors.NETWORK_ERROR'),
        });
      }
    };

    let token = auth ? config.getAccessToken() : null;
    if (auth && !token && retryOnUnauthorized) {
      // No token in memory (fresh tab / reload): try the cookie before hitting the endpoint.
      const refreshed = await refresh();
      token = refreshed?.accessToken ?? null;
      if (!token) {
        config.onUnauthorized?.();
        throw new ApiError({
          status: 401,
          code: ErrorCode.UNAUTHORIZED,
          message: defaultMessageForStatus(401),
        });
      }
    }

    let res = await perform(token);

    if (res.status === 401 && auth && retryOnUnauthorized) {
      const refreshed = await refresh();
      if (refreshed?.accessToken) {
        res = await perform(refreshed.accessToken);
      } else {
        config.onUnauthorized?.();
        throw await toApiError(res);
      }
    }

    if (!res.ok) throw await toApiError(res);
    return res;
  };

  const request = async <T>(path: string, options: RequestOptions = {}): Promise<ApiSuccess<T>> => {
    const res = await fetchRaw(path, options);
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return { data: undefined as T };
    }
    const text = await res.text();
    if (!text) return { data: undefined as T };
    return JSON.parse(text) as ApiSuccess<T>;
  };

  type Opts = Omit<RequestOptions, 'method' | 'body'>;

  const get = async <T>(path: string, options?: Opts): Promise<T> =>
    (await request<T>(path, { ...options, method: 'GET' })).data;
  const post = async <T>(path: string, body?: unknown, options?: Opts): Promise<T> =>
    (await request<T>(path, { ...options, method: 'POST', body })).data;
  const put = async <T>(path: string, body?: unknown, options?: Opts): Promise<T> =>
    (await request<T>(path, { ...options, method: 'PUT', body })).data;
  const patch = async <T>(path: string, body?: unknown, options?: Opts): Promise<T> =>
    (await request<T>(path, { ...options, method: 'PATCH', body })).data;
  const del = async <T = void>(path: string, options?: Opts): Promise<T> =>
    (await request<T>(path, { ...options, method: 'DELETE' })).data;
  const list = async <T>(
    path: string,
    query?: QueryParams,
    options?: Omit<RequestOptions, 'method' | 'body' | 'query'>,
  ): Promise<ApiListResult<T>> => {
    const res = await request<T[]>(path, { ...options, method: 'GET', query });
    const meta = (res.meta ?? {}) as Partial<PaginationMeta>;
    const data = Array.isArray(res.data) ? res.data : [];
    return {
      data,
      meta: {
        page: meta.page ?? Number(query?.page ?? 1),
        pageSize: meta.pageSize ?? Number(query?.pageSize ?? data.length),
        total: meta.total ?? data.length,
        totalPages: meta.totalPages ?? 1,
      },
    };
  };

  return { request, fetchRaw, refresh, get, post, put, patch, delete: del, list };
}

/** Application-wide client wired to the session store. */
export const api: ApiClient = createApiClient({
  baseUrl: env.apiUrl,
  getAccessToken: () => useSession.getState().accessToken,
  setAccessToken: (token) => useSession.getState().setAccessToken(token),
  getOrganizationId: () => useSession.getState().activeOrganizationId,
  onRefreshed: (auth) => useSession.getState().applyAuthResponse(auth),
  onUnauthorized: () => {
    const state = useSession.getState();
    if (state.status !== 'unauthenticated') state.clear();
  },
});
