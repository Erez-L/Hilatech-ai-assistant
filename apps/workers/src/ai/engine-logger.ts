import type { EngineLogger } from '@hilatech/ai-engine';
import type { PinoLogger } from 'nestjs-pino';

/** Adapt nestjs-pino's `PinoLogger` to the engine's minimal `EngineLogger` surface. */
export function toEngineLogger(logger: PinoLogger): EngineLogger {
  return {
    debug: (obj, msg) => logger.debug(obj, msg),
    info: (obj, msg) => logger.info(obj, msg),
    warn: (obj, msg) => logger.warn(obj, msg),
    error: (obj, msg) => logger.error(obj, msg),
  };
}
