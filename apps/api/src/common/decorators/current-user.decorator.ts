import { type Principal } from '@hilatech/types';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { type AppRequest } from '../request';

/** Injects the authenticated `Principal` (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.user) {
      throw new Error('CurrentUser() used on a route without JwtAuthGuard');
    }
    return req.user;
  },
);
