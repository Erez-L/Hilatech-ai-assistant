import { ErrorCode } from '@hilatech/contracts';
import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

import { REQUEST_TIMEOUT_KEY } from '../decorators/request-timeout.decorator';
import { AppException } from '../errors/app.exception';

/**
 * Fails requests whose handler does not complete within `REQUEST_TIMEOUT_MS` (504). A handler may
 * override the budget with `@RequestTimeout(ms)` (long AI turns); `0` disables the timeout for it.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(
    private readonly timeoutMs: number,
    private readonly reflector?: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const override = this.reflector?.getAllAndOverride<number | undefined>(REQUEST_TIMEOUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const budget = override ?? this.timeoutMs;
    if (budget <= 0) return next.handle();
    return next.handle().pipe(
      timeout(budget),
      catchError((err) =>
        throwError(() =>
          err instanceof TimeoutError
            ? new AppException(
                HttpStatus.GATEWAY_TIMEOUT,
                ErrorCode.INTERNAL_ERROR,
                'Request timed out',
              )
            : err,
        ),
      ),
    );
  }
}
