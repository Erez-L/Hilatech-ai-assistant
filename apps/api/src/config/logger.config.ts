import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER } from '@hilatech/contracts';
import { SENSITIVE_LOG_PATHS } from '@hilatech/shared';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import { type Params } from 'nestjs-pino';

import { resolveRequestId } from '../common/middleware/request-id.middleware';
import { type Env } from './env.schema';

type ReqWithId = IncomingMessage & {
  id?: string;
  requestId?: string;
  user?: { userId?: string };
  tenant?: { organizationId?: string };
};

/** nestjs-pino configuration: request-id propagation, redaction, pretty output outside production. */
export function buildLoggerParams(
  env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV' | 'isProduction' | 'isTest'>,
): Params {
  return {
    // Express 5 / path-to-regexp 8 require named wildcards (the default '*' triggers a legacy-conversion warning).
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    pinoHttp: {
      level: env.isTest ? 'silent' : env.LOG_LEVEL,
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const r = req as ReqWithId;
        const id =
          resolveRequestId(req.headers[REQUEST_ID_HEADER], r.requestId ?? r.id) || randomUUID();
        r.id = id;
        r.requestId = id;
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      customProps: (req: IncomingMessage) => {
        const r = req as ReqWithId;
        return {
          requestId: r.requestId ?? r.id,
          userId: r.user?.userId,
          organizationId: r.tenant?.organizationId,
        };
      },
      redact: { paths: [...SENSITIVE_LOG_PATHS], censor: '[REDACTED]' },
      autoLogging: {
        ignore: (req: IncomingMessage) => (req.url ?? '').includes('/health'),
      },
      customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req: (req: { id?: string; method?: string; url?: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      ...(env.isProduction
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            },
          }),
    },
  };
}
