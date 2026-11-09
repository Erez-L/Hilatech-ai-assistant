import { SENSITIVE_LOG_PATHS } from '@hilatech/shared';
import type { Params } from 'nestjs-pino';
import type { WorkersEnv } from '../config/env.schema';

/**
 * pino configuration for the workers: pretty output in development, JSON elsewhere, and redaction of
 * every path in `SENSITIVE_LOG_PATHS` (shared with the API) so tokens/passwords never reach the logs.
 */
export function buildLoggerOptions(env: WorkersEnv): Params {
  const pretty = env.NODE_ENV === 'development';
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service: 'workers', pid: process.pid },
      redact: { paths: [...SENSITIVE_LOG_PATHS], censor: '[REDACTED]' },
      // No HTTP framework behind this logger; keep request-logging features off.
      autoLogging: false,
      quietReqLogger: true,
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname,service',
              },
            },
          }
        : {}),
    },
  };
}
