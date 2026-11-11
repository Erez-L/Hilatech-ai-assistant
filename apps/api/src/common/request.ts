import { type Principal, type TenantContext } from '@hilatech/types';
import { type Request } from 'express';

/** Express request augmented by our middleware/guards. */
export interface AppRequest extends Request {
  /** Request id assigned by RequestIdMiddleware / pino-http (also exposed as `x-request-id`). */
  id: string | number | object;
  requestId?: string;
  /** Set by JwtAuthGuard (passport stores the strategy's return value on `req.user`). */
  user?: Principal;
  /** Set by OrganizationGuard. */
  tenant?: TenantContext;
}

/** Request metadata captured for audit logs. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  /** First language of the request's `Accept-Language` header (used to pick the language of emails). */
  locale?: string | null;
}

export function requestIdOf(
  req: Pick<AppRequest, 'id' | 'requestId'> | undefined,
): string | undefined {
  if (!req) return undefined;
  if (typeof req.requestId === 'string') return req.requestId;
  return typeof req.id === 'string' ? req.id : undefined;
}

export function requestMeta(
  req: Pick<AppRequest, 'ip' | 'headers' | 'id' | 'requestId'> | undefined,
): RequestMeta {
  if (!req) return { ipAddress: null, userAgent: null, requestId: null };
  const ua = req.headers['user-agent'];
  const language = req.headers['accept-language'];
  return {
    ipAddress: req.ip ? String(req.ip).slice(0, 64) : null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 512) : null,
    requestId: requestIdOf(req) ?? null,
    locale:
      typeof language === 'string' && language.trim()
        ? (language.split(',')[0] ?? '').split(';')[0]!.trim().slice(0, 16) || null
        : null,
  };
}
