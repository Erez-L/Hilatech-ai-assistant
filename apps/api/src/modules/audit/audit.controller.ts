import {
  ErrorCode,
  Permission,
  auditLogSchema,
  listAuditLogsQuerySchema,
  type ListAuditLogsQuery,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { RequirePermissions, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiOperation({ summary: 'List audit logs of the current organization' })
  @ApiZodQuery(listAuditLogsQuerySchema)
  @ApiZodResponse(auditLogSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR])
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listAuditLogsQuerySchema)) query: ListAuditLogsQuery,
  ) {
    return this.audit.list(tenant, query);
  }
}
