import { AiNotConfiguredError, AiProviderError, LimitExceededError } from '@hilatech/ai-engine';
import { ErrorCode } from '@hilatech/contracts';
import { HttpStatus } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';

/**
 * Translates engine failures into API errors:
 *   AiNotConfiguredError → 409 AI_NOT_CONFIGURED
 *   AiProviderError      → 502 AI_PROVIDER_ERROR (normalised code in `details`)
 *   LimitExceededError   → 422 AI_LIMIT_EXCEEDED (limit, value, max in `details`)
 * Anything else is returned untouched so the global filter treats it as an internal error.
 */
export function mapEngineError(error: unknown): unknown {
  if (error instanceof AppException) return error;
  if (error instanceof AiNotConfiguredError) {
    return new AppException(HttpStatus.CONFLICT, ErrorCode.AI_NOT_CONFIGURED, error.message);
  }
  if (error instanceof AiProviderError) {
    return new AppException(
      HttpStatus.BAD_GATEWAY,
      ErrorCode.AI_PROVIDER_ERROR,
      `AI provider request failed (${error.code})`,
      {
        provider: error.provider,
        code: error.code,
        retryable: error.retryable,
        status: error.status,
        message: error.message,
      },
    );
  }
  if (error instanceof LimitExceededError) {
    return new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.AI_LIMIT_EXCEEDED,
      error.message,
      { limit: error.limit, value: error.value, max: error.max },
    );
  }
  return error;
}

/** Runs `fn`, rethrowing engine errors as API errors. */
export async function withEngineErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw mapEngineError(error);
  }
}
