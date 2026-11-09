import { ErrorCode } from '@hilatech/contracts';
import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

import { AppException } from '../errors/app.exception';

/** Fails requests whose handler does not complete within `REQUEST_TIMEOUT_MS` (504). */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly timeoutMs: number) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
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
