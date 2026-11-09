import { Permission } from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrors, ApiZodResponse, COMMON_TENANT_ERRORS } from '../../common/openapi/zod-openapi';
import { AnalyticsService, dashboardSummarySchema } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @RequirePermissions(Permission.ANALYTICS_READ)
  @ApiOperation({ summary: 'Dashboard counters for the organization' })
  @ApiZodResponse(dashboardSummarySchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  dashboard(@Tenant() tenant: TenantContext) {
    return this.analytics.dashboard(tenant);
  }
}
