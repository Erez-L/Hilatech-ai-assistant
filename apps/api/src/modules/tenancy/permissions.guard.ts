import { AuditAction, type Permission } from '@hilatech/contracts';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { AppException } from '../../common/errors/app.exception';
import { type AppRequest } from '../../common/request';
import { AuditService } from '../audit/audit.service';

/** Enforces `@RequirePermissions(...)` against `TenantContext.permissions` (all required). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const tenant = req.tenant;
    if (!tenant) {
      // A route demanded permissions but no tenant was resolved (misconfigured @NoTenant + @RequirePermissions).
      throw AppException.forbidden(
        'Permissions can only be enforced inside an organization context',
      );
    }

    const granted = new Set(tenant.permissions);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length === 0) return true;

    await this.audit.log({
      action: AuditAction.PERMISSION_DENIED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      metadata: { required, missing, method: req.method, path: req.originalUrl ?? req.url },
      request: req,
    });
    throw AppException.forbidden('Missing required permission', { required: missing });
  }
}
