import {
  type AnalyticsExportQuery,
  type AnalyticsRangeQuery,
  Permission,
  agentAnalyticsSchema,
  analyticsExportQuerySchema,
  analyticsRangeQuerySchema,
  automationAnalyticsSchema,
  businessAnalyticsSchema,
  salesAnalyticsSchema,
  usageAnalyticsSchema,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';

import { RequirePermissions, SkipTransform, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsReportsService } from './analytics-reports.service';

const rangePipe = new ZodValidationPipe(analyticsRangeQuerySchema);

/** Org-scoped analytics reports; all require `analytics:read`. Dates are UTC, `to` is exclusive. */
@ApiTags('analytics')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('analytics')
export class AnalyticsReportsController {
  constructor(private readonly reports: AnalyticsReportsService) {}

  @Get('business')
  @RequirePermissions(Permission.ANALYTICS_READ)
  @ApiOperation({ summary: 'Leads by status/source, conversion funnel, conversations, contacts' })
  @ApiZodQuery(analyticsRangeQuerySchema)
  @ApiZodResponse(businessAnalyticsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  business(@Tenant() tenant: TenantContext, @Query(rangePipe) query: AnalyticsRangeQuery) {
    return this.reports.business(tenant, query);
  }

  @Get('sales')
  @RequirePermissions(Permission.ANALYTICS_READ)
  @ApiOperation({
    summary:
      'Pipeline and closed value per currency, win rate, cycle time (derived from leads; no Deal model)',
  })
  @ApiZodQuery(analyticsRangeQuerySchema)
  @ApiZodResponse(salesAnalyticsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  sales(@Tenant() tenant: TenantContext, @Query(rangePipe) query: AnalyticsRangeQuery) {
    return this.reports.sales(tenant, query);
  }

  @Get('agents')
  @RequirePermissions(Permission.ANALYTICS_READ)
  @ApiOperation({
    summary: 'Agent executions by status, success rate, p50/p95 duration, tokens, cost (if priced)',
  })
  @ApiZodQuery(analyticsRangeQuerySchema)
  @ApiZodResponse(agentAnalyticsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  agents(@Tenant() tenant: TenantContext, @Query(rangePipe) query: AnalyticsRangeQuery) {
    return this.reports.agents(tenant, query);
  }

  @Get('automation')
  @RequirePermissions(Permission.ANALYTICS_READ)
  @ApiOperation({ summary: 'Workflow runs by status, failure reasons, webhook delivery success' })
  @ApiZodQuery(analyticsRangeQuerySchema)
  @ApiZodResponse(automationAnalyticsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  automation(@Tenant() tenant: TenantContext, @Query(rangePipe) query: AnalyticsRangeQuery) {
    return this.reports.automation(tenant, query);
  }

  @Get('usage')
  @RequirePermissions(Permission.ANALYTICS_READ)
  @ApiOperation({
    summary: 'AI requests/tokens by model, agent, user and period vs plan limits and budget',
  })
  @ApiZodQuery(analyticsRangeQuerySchema)
  @ApiZodResponse(usageAnalyticsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  usage(@Tenant() tenant: TenantContext, @Query(rangePipe) query: AnalyticsRangeQuery) {
    return this.reports.usage(tenant, query);
  }

  @Get('export')
  @RequirePermissions(Permission.ANALYTICS_READ)
  @SkipTransform()
  @ApiOperation({ summary: 'CSV export of the business or usage report (series or breakdown)' })
  @ApiZodQuery(analyticsExportQuerySchema)
  @ApiProduces('text/csv')
  @ApiErrors(...COMMON_TENANT_ERRORS)
  async export(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(analyticsExportQuerySchema)) query: AnalyticsExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { filename, csv } = await this.reports.exportCsv(tenant, query);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return csv;
  }
}
