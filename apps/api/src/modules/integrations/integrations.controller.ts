import {
  type CreateIntegrationRequest,
  ErrorCode,
  Permission,
  type UpdateIntegrationRequest,
  createIntegrationSchema,
  integrationCatalogueEntrySchema,
  integrationSchema,
  integrationTestResultSchema,
  updateIntegrationSchema,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Req, RequirePermissions, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { type AppRequest, requestMeta } from '../../common/request';
import { IntegrationsService } from './integrations.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];

const statusEntrySchema = z.object({
  kind: z.string(),
  liveSupport: z.enum(['full', 'partial', 'planned']),
  connected: z.number().int(),
  total: z.number().int(),
  availability: z.enum(['available', 'not_configured']),
});

@ApiTags('integrations')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('catalog')
  @RequirePermissions(Permission.INTEGRATIONS_READ)
  @ApiOperation({
    summary: 'Integration kinds, required secrets and whether live support exists in this release',
  })
  @ApiZodResponse(z.array(integrationCatalogueEntrySchema))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  catalogue() {
    return this.integrations.catalogue();
  }

  @Get('status')
  @RequirePermissions(Permission.INTEGRATIONS_READ)
  @ApiOperation({
    summary:
      'Per-kind summary: connected/total counts and availability (available | not_configured)',
  })
  @ApiZodResponse(z.array(statusEntrySchema))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  status(@Tenant() tenant: TenantContext) {
    return this.integrations.status(tenant);
  }

  @Get()
  @RequirePermissions(Permission.INTEGRATIONS_READ)
  @ApiOperation({ summary: 'List connected integrations (secret names only, never values)' })
  @ApiZodResponse(z.array(integrationSchema))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(@Tenant() tenant: TenantContext) {
    return this.integrations.list(tenant);
  }

  @Post()
  @RequirePermissions(Permission.INTEGRATIONS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Connect an integration. Credentials are encrypted at rest and write-only. rest/n8n are tested immediately.',
  })
  @ApiZodBody(createIntegrationSchema)
  @ApiZodResponse(integrationSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, CONFLICT)
  connect(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createIntegrationSchema)) body: CreateIntegrationRequest,
    @Req() req: AppRequest,
  ) {
    return this.integrations.connect(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.INTEGRATIONS_READ)
  @ApiOperation({ summary: 'Get an integration (status, last check, secret names)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(integrationSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.integrations.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.INTEGRATIONS_MANAGE)
  @ApiOperation({
    summary:
      'Update name/config/secrets (secrets merge; "" deletes a key). Resets status until re-tested',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateIntegrationSchema)
  @ApiZodResponse(integrationSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateIntegrationSchema)) body: UpdateIntegrationRequest,
    @Req() req: AppRequest,
  ) {
    return this.integrations.update(tenant, id, body, requestMeta(req));
  }

  @Post(':id/test')
  @RequirePermissions(Permission.INTEGRATIONS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Run the connectivity test. Configuration-only kinds always report ok=false (unconfigured)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(integrationTestResultSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  test(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string, @Req() req: AppRequest) {
    return this.integrations.test(tenant, id, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.INTEGRATIONS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect: deletes the integration and its stored credentials' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async disconnect(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.integrations.disconnect(tenant, id, requestMeta(req));
  }
}
