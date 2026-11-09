import {
  Permission,
  planLimitsSchema,
  subscriptionSchema,
  usageSummarySchema,
  PlanKey,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { NoTenant, RequirePermissions, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodResponse,
  COMMON_AUTH_ERRORS,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { BillingService } from './billing.service';

const planCatalogEntrySchema = z.object({ key: PlanKey, limits: planLimitsSchema });

@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('subscription')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_READ)
  @ApiOperation({ summary: 'Current subscription of the organization' })
  @ApiZodResponse(subscriptionSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  subscription(@Tenant() tenant: TenantContext) {
    return this.billing.getSubscription(tenant);
  }

  @Get('usage')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_READ)
  @ApiOperation({ summary: 'Usage of the current month versus plan limits' })
  @ApiZodResponse(usageSummarySchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  usage(@Tenant() tenant: TenantContext) {
    return this.billing.getUsage(tenant);
  }

  @Get('plans')
  @NoTenant()
  @ApiOperation({ summary: 'Plan catalog with limits' })
  @ApiZodResponse(z.array(planCatalogEntrySchema))
  @ApiErrors(...COMMON_AUTH_ERRORS)
  plans() {
    return this.billing.listPlans();
  }
}
