import { ErrorCode } from '@hilatech/contracts';
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { type Observable } from 'rxjs';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AppException } from '../../common/errors/app.exception';

/** Global authentication guard. Routes marked `@Public()` are skipped. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  override handleRequest<TUser = unknown>(err: unknown, user: TUser | false, info: unknown): TUser {
    if (err) throw err;
    if (!user) {
      const name = (info as { name?: string } | undefined)?.name;
      if (name === 'TokenExpiredError') {
        throw AppException.unauthorized('Access token expired', ErrorCode.TOKEN_EXPIRED);
      }
      if (name === 'JsonWebTokenError' || name === 'NotBeforeError' || name === 'SyntaxError') {
        throw AppException.unauthorized('Invalid access token', ErrorCode.TOKEN_INVALID);
      }
      throw AppException.unauthorized();
    }
    return user;
  }
}
