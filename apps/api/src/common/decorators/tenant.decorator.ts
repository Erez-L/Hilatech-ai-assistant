import { type TenantContext } from '@hilatech/types';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { type AppRequest } from '../request';

/** Injects the resolved `TenantContext` (set by OrganizationGuard). */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.tenant) {
      throw new Error(
        'Tenant() used on a route without OrganizationGuard (did you mark it @NoTenant()?)',
      );
    }
    return req.tenant;
  },
);
