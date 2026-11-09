import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER } from '@hilatech/contracts';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';

import { type AppRequest, requestIdOf } from '../request';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Picks a safe incoming `x-request-id` (or generates one). Unsafe client values are replaced. */
export function resolveRequestId(incoming: unknown, existing?: string): string {
  if (typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)) return incoming;
  if (existing && SAFE_REQUEST_ID.test(existing)) return existing;
  return randomUUID();
}

/**
 * Express-level handler: assigns `req.id` / `req.requestId` and echoes `x-request-id`. Registered
 * first in `createApp()` so even body-parser failures carry a request id, and again as a Nest
 * middleware (idempotent) for module-level composition.
 */
export function assignRequestId(req: Request, res: Response, next: NextFunction): void {
  const r = req as AppRequest;
  const id = resolveRequestId(req.headers[REQUEST_ID_HEADER], requestIdOf(r));
  r.id = id;
  r.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    assignRequestId(req, res, next);
  }
}
