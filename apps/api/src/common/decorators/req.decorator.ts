import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { type AppRequest } from '../request';

/** Typed access to the raw request (for audit metadata: ip, user agent, request id). */
export const Req = createParamDecorator((_data: unknown, ctx: ExecutionContext): AppRequest => {
  return ctx.switchToHttp().getRequest<AppRequest>();
});
