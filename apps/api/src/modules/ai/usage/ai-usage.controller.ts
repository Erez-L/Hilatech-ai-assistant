import {
  type ListAiRequestLogsQuery,
  Permission,
  aiRequestLogSchema,
  aiUsageSummarySchema,
  listAiRequestLogsQuerySchema,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { RequirePermissions, Tenant } from '../../../common/decorators';
import {
  ApiErrors,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AiUsageService, type UsageSummaryQuery } from './ai-usage.service';

const usageSummaryQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

@ApiTags('ai')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('ai/usage')
export class AiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Get('summary')
  @RequirePermissions(Permission.AI_CONFIG_READ)
  @ApiOperation({
    summary:
      'AI usage summary for a period (default: current UTC month) incl. the plan token limit',
  })
  @ApiZodQuery(usageSummaryQuerySchema)
  @ApiZodResponse(aiUsageSummarySchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  summary(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(usageSummaryQuerySchema)) query: UsageSummaryQuery,
  ) {
    return this.usage.summary(tenant, query);
  }

  @Get('requests')
  @RequirePermissions(Permission.AI_CONFIG_READ)
  @ApiOperation({ summary: 'Per-call AI request log, newest first' })
  @ApiZodQuery(listAiRequestLogsQuerySchema)
  @ApiZodResponse(aiRequestLogSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  requests(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listAiRequestLogsQuerySchema)) query: ListAiRequestLogsQuery,
  ) {
    return this.usage.listRequests(tenant, query);
  }
}
