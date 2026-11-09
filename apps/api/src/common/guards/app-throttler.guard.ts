import { type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  ThrottlerStorage,
  getOptionsToken,
  getStorageToken,
} from '@nestjs/throttler';

import { AppConfig } from '../../config/app-config.service';
import { AUTH_THROTTLE_KEY } from '../decorators/auth-throttle.decorator';
import { AppException } from '../errors/app.exception';

/**
 * Global rate limiter. Routes marked `@AuthThrottle()` use the stricter `AUTH_RATE_LIMIT_MAX`
 * (login, register, forgot/reset password…). Exceeding a limit yields `429 RATE_LIMITED`.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly authLimit: number;

  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storage: ThrottlerStorage,
    reflector: Reflector,
    config: AppConfig,
  ) {
    super(options, storage, reflector);
    this.authLimit = config.get('AUTH_RATE_LIMIT_MAX');
  }

  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const isAuthRoute = this.reflector.getAllAndOverride<boolean>(AUTH_THROTTLE_KEY, [
      requestProps.context.getHandler(),
      requestProps.context.getClass(),
    ]);
    if (isAuthRoute) {
      return super.handleRequest({
        ...requestProps,
        limit: Math.min(requestProps.limit, this.authLimit),
      });
    }
    return super.handleRequest(requestProps);
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    _detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw AppException.rateLimited();
  }
}
