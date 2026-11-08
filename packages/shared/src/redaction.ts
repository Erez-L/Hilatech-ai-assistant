/** Keys whose values must never appear in logs. Used by pino `redact` in API and workers. */
export const SENSITIVE_LOG_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'token',
  'apiKey',
  'secret',
  '*.password',
  '*.apiKey',
  '*.secret',
  '*.token',
];

const SENSITIVE_KEY = /(password|secret|token|api[-_]?key|authorization|cookie)/i;

/** Deep-clone an object replacing sensitive values with "[REDACTED]". For audit metadata and error details. */
export function redactSensitive<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redactSensitive(v, depth + 1);
  }
  return out as T;
}
