import { AuditAction, ORGANIZATION_HEADER, idSchema } from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { NO_TENANT_KEY } from '../../common/decorators/no-tenant.decorator';
import { AppException } from '../../common/errors/app.exception';
import { type AppRequest } from '../../common/request';
import { AuditService } from '../audit/audit.service';
import { TenancyService } from './tenancy.service';

/**
 * Resolves `request.tenant` from the `x-organization-id` header (a selector only) by validating that
 * the authenticated user holds an ACTIVE membership in a NON-DELETED organization (ADR-004).
 * Skipped for `@Public()` and `@NoTenant()` routes.
 */
@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(NO_TENANT_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    const principal = req.user;
    if (!principal) throw AppException.unauthorized();

    const raw = req.headers[ORGANIZATION_HEADER];
    const headerValue = Array.isArray(raw) ? raw[0] : raw;
    if (!headerValue) throw AppException.organizationRequired();
    const parsed = idSchema.safeParse(headerValue);
    if (!parsed.success)
      throw AppException.organizationRequired('Invalid x-organization-id header');

    const tenant: TenantContext | null = await this.tenancy.resolveTenant(
      principal.userId,
      parsed.data,
    );
    if (!tenant) {
      await this.audit.log({
        action: AuditAction.TENANT_VIOLATION_ATTEMPT,
        actorUserId: principal.userId,
        targetType: 'organization',
        targetId: parsed.data,
        metadata: {
          attemptedOrganizationId: parsed.data,
          method: req.method,
          path: req.originalUrl ?? req.url,
        },
        request: req,
      });
      throw AppException.notAMember();
    }

    req.tenant = tenant;
    return true;
  }
}
