/** Auth/header construction for `rest` and `n8n` integrations, shared by the API (test) and the workers (runtime). */

export interface RestAuthConfig {
  authType?: 'none' | 'bearer' | 'basic' | 'header';
  authHeaderName?: string | undefined;
  headers?: Record<string, string> | undefined;
}

export interface RestSecrets {
  username?: string | undefined;
  password?: string | undefined;
  apiKey?: string | undefined;
  accessToken?: string | undefined;
  headers?: Record<string, string> | undefined;
}

/** Static headers + credentials for a REST integration. Secret values only ever flow server-side. */
export function buildRestHeaders(config: RestAuthConfig, secrets: RestSecrets = {}): Record<string, string> {
  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  switch (config.authType ?? 'none') {
    case 'bearer': {
      const token = secrets.accessToken ?? secrets.apiKey;
      if (token) headers.authorization = `Bearer ${token}`;
      break;
    }
    case 'basic':
      if (secrets.username !== undefined && secrets.password !== undefined) {
        headers.authorization = `Basic ${Buffer.from(`${secrets.username}:${secrets.password}`).toString('base64')}`;
      }
      break;
    case 'header':
      if (config.authHeaderName && secrets.apiKey) headers[config.authHeaderName.toLowerCase()] = secrets.apiKey;
      break;
    default:
      break;
  }
  for (const [k, v] of Object.entries(secrets.headers ?? {})) headers[k.toLowerCase()] = v;
  return headers;
}

export function buildN8nHeaders(secrets: RestSecrets = {}): Record<string, string> {
  return secrets.apiKey ? { 'x-n8n-api-key': secrets.apiKey } : {};
}

/** Joins a base URL and a path/URL fragment without double slashes. Absolute `http(s)://` inputs are returned as-is. */
export function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
