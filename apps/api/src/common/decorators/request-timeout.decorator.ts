import { SetMetadata } from '@nestjs/common';

export const REQUEST_TIMEOUT_KEY = 'hta:requestTimeoutMs';

/**
 * Overrides `REQUEST_TIMEOUT_MS` for one handler (long-running AI calls: assistant turns, synchronous
 * agent executions). Pass `0` to disable the timeout for the handler entirely.
 */
export const RequestTimeout = (timeoutMs: number) => SetMetadata(REQUEST_TIMEOUT_KEY, timeoutMs);
