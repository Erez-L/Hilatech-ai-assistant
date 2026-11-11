import { ErrorCode } from '@hilatech/contracts';
import { type Principal } from '@hilatech/types';
import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppConfig } from '../../config/app-config.service';
import { ALLOW_UNVERIFIED_KEY } from '../decorators/allow-unverified.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../errors/app.exception';

/**
 * When `REQUIRE_EMAIL_VERIFICATION` is on, signed-in users with an unverified email address can only
 * reach routes marked `@AllowUnverified()`; everything else answers `403 EMAIL_NOT_VERIFIED`.
 * Runs after authentication and before the tenant guard.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.get('REQUIRE_EMAIL_VERIFICATION')) return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, targets)) return true;
    const principal = context.switchToHttp().getRequest<{ user?: Principal }>().user;
    if (!principal || principal.emailVerified) return true;
    throw new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.EMAIL_NOT_VERIFIED,
      'Verify your email address to continue',
    );
  }
}
