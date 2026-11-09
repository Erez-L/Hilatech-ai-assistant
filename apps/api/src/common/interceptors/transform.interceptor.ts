import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, map } from 'rxjs';

import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator';
import { PageResult } from '../utils/pagination';

/** Wraps handler results into the success envelope `{ data, meta? }`. */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();
    return next.handle().pipe(map((result) => transformResult(result)));
  }
}

export function transformResult(result: unknown): unknown {
  if (result === undefined) return undefined; // 204 / empty responses
  if (result instanceof PageResult) return { data: result.data, meta: result.meta };
  return { data: result };
}
