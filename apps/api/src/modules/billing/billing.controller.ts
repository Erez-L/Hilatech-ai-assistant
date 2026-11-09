import {
  type BudgetAlert,
  type CheckoutRequest,
  type ListBudgetAlertsQuery,
  Permission,
  type UpdateBudgetRequest,
  budgetAlertSchema,
  budgetStatusSchema,
  checkoutRequestSchema,
  entitlementsOverviewSchema,
  listBudgetAlertsQuerySchema,
  planCatalogEntrySchema,
  subscriptionSchema,
  updateBudgetRequestSchema,
  upgradeOptionsSchema,
  usageSummarySchema,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { NoTenant, RequirePermissions, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_AUTH_ERRORS,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { type AppRequest, requestMeta } from '../../common/request';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { type PageResult } from '../../common/utils/pagination';
import { BillingService } from './billing.service';
import { BudgetService } from './budget.service';

@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly budget: BudgetService,
  ) {}

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

  @Get('entitlements')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_READ)
  @ApiOperation({
    summary:
      'Every plan entitlement with real consumption, percent and state (ok | warning | exceeded)',
  })
  @ApiZodResponse(entitlementsOverviewSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  entitlements(@Tenant() tenant: TenantContext) {
    return this.billing.getEntitlements(tenant);
  }

  @Get('upgrade-options')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_READ)
  @ApiOperation({
    summary: 'Upgrade-flow data: pressured entitlements and higher plans (no payment provider)',
  })
  @ApiZodResponse(upgradeOptionsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  upgradeOptions(@Tenant() tenant: TenantContext) {
    return this.billing.getUpgradeOptions(tenant);
  }

  @Post('checkout')
  @ApiSecurity('organization')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @RequirePermissions(Permission.ORG_BILLING_MANAGE)
  @ApiOperation({ summary: 'Start a plan checkout — always 501 PAYMENT_NOT_CONFIGURED today' })
  @ApiZodBody(checkoutRequestSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  checkout(@Body(new ZodValidationPipe(checkoutRequestSchema)) _dto: CheckoutRequest) {
    return this.billing.checkoutNotConfigured();
  }

  @Get('budget')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_READ)
  @ApiOperation({ summary: 'AI budget settings and current-month status' })
  @ApiZodResponse(budgetStatusSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  getBudget(@Tenant() tenant: TenantContext) {
    return this.budget.evaluate(tenant.organizationId);
  }

  @Put('budget')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_BILLING_MANAGE)
  @ApiOperation({
    summary: 'Update the monthly AI token/cost budget, warning threshold and hard stop',
  })
  @ApiZodBody(updateBudgetRequestSchema)
  @ApiZodResponse(budgetStatusSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  updateBudget(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(updateBudgetRequestSchema)) dto: UpdateBudgetRequest,
    @Req() req: AppRequest,
  ) {
    return this.budget.update(tenant, dto, requestMeta(req));
  }

  @Get('alerts')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_BILLING_MANAGE)
  @ApiOperation({ summary: 'Budget / plan-allowance threshold alerts raised for this organization' })
  @ApiZodQuery(listBudgetAlertsQuerySchema)
  @ApiZodResponse(budgetAlertSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  alerts(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listBudgetAlertsQuerySchema)) query: ListBudgetAlertsQuery,
  ): Promise<PageResult<BudgetAlert>> {
    return this.budget.listAlerts(tenant, query);
  }
}
