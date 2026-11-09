export type AiErrorCode =
  | 'auth'
  | 'rate_limited'
  | 'invalid_request'
  | 'timeout'
  | 'server'
  | 'content_filter'
  | 'unsupported'
  | 'unknown';

/** Normalised provider failure. Business code never sees SDK-specific error classes. */
export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly provider: string;

  constructor(params: {
    provider: string;
    code: AiErrorCode;
    message: string;
    retryable?: boolean;
    status?: number | null;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = 'AiProviderError';
    this.provider = params.provider;
    this.code = params.code;
    this.retryable =
      params.retryable ??
      (params.code === 'rate_limited' || params.code === 'server' || params.code === 'timeout');
    this.status = params.status ?? null;
  }
}

/** The organization has no usable provider configuration. */
export class AiNotConfiguredError extends Error {
  constructor(message = 'No AI provider is configured for this organization') {
    super(message);
    this.name = 'AiNotConfiguredError';
  }
}

export type LimitKind =
  'steps' | 'duration' | 'tokens' | 'delegations' | 'delegation_depth' | 'tool_calls';

/** An execution hit one of its hard or configured limits. */
export class LimitExceededError extends Error {
  readonly limit: LimitKind;
  readonly value: number;
  readonly max: number;

  constructor(limit: LimitKind, value: number, max: number) {
    super(`Execution limit exceeded: ${limit} (${value} > ${max})`);
    this.name = 'LimitExceededError';
    this.limit = limit;
    this.value = value;
    this.max = max;
  }
}

/** A tool call was refused by the permission layer. */
export class ToolDeniedError extends Error {
  readonly reason:
    | 'unknown_tool'
    | 'not_allowed_for_agent'
    | 'missing_permission'
    | 'write_not_allowed'
    | 'requires_authorization'
    | 'invalid_input';

  constructor(reason: ToolDeniedError['reason'], message: string) {
    super(message);
    this.name = 'ToolDeniedError';
    this.reason = reason;
  }
}

/** Map an HTTP-ish status to a normalised code. */
export function codeFromStatus(status: number | undefined | null): AiErrorCode {
  if (!status) return 'unknown';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  if (status >= 400) return 'invalid_request';
  return 'unknown';
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}
