import {
  type DashboardQuery,
  Permission,
  dashboardQuerySchema,
  dashboardSummarySchema,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { RequirePermissions, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard')
  @RequirePermissions(Permission.ANALYTICS_READ)
  @ApiOperation({ summary: 'Dashboard summary for the organization (period 7d | 30d | 90d)' })
  @ApiZodQuery(dashboardQuerySchema)
  @ApiZodResponse(dashboardSummarySchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  dashboard(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) query: DashboardQuery,
  ) {
    return this.analytics.dashboard(tenant, query);
  }
}
