import { type EngineLogger } from '@hilatech/ai-engine';
import { type PinoLogger } from 'nestjs-pino';

/** Injection token for the engine-facing logger (pino under the hood). */
export const ENGINE_LOGGER = Symbol('ENGINE_LOGGER');

/**
 * Adapts nestjs-pino to the engine's `EngineLogger` surface. `PinoLogger.logger` resolves the
 * request-bound logger when called inside a request (request id, user, organization are attached)
 * and the root logger otherwise (workers-style background work).
 */
export function createEngineLogger(pino: PinoLogger, context = 'AiEngine'): EngineLogger {
  return {
    debug: (obj, msg) => pino.logger.debug({ context, ...obj }, msg),
    info: (obj, msg) => pino.logger.info({ context, ...obj }, msg),
    warn: (obj, msg) => pino.logger.warn({ context, ...obj }, msg),
    error: (obj, msg) => pino.logger.error({ context, ...obj }, msg),
  };
}
