import {
  AiProviderKind,
  type CreateAiProviderConfigRequest,
  ErrorCode,
  Permission,
  type UpdateAiProviderConfigRequest,
  aiHealthCheckResultSchema,
  aiModelInfoSchema,
  aiProviderConfigSchema,
  createAiProviderConfigSchema,
  updateAiProviderConfigSchema,
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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Req, RequestTimeout, RequirePermissions, Tenant } from '../../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../../common/openapi/zod-openapi';
import { UuidPipe } from '../../../common/pipes/uuid.pipe';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { type AppRequest, requestMeta } from '../../../common/request';
import { AiProvidersService } from './ai-providers.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];

const listModelsQuerySchema = z.object({ provider: AiProviderKind.optional() });
type ListModelsQuery = z.infer<typeof listModelsQuerySchema>;

@ApiTags('ai')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('ai')
export class AiProvidersController {
  constructor(private readonly providers: AiProvidersService) {}

  @Get('providers')
  @RequirePermissions(Permission.AI_CONFIG_READ)
  @ApiOperation({ summary: 'List AI provider configurations (keys are never returned)' })
  @ApiZodResponse(aiProviderConfigSchema.array())
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(@Tenant() tenant: TenantContext) {
    return this.providers.list(tenant);
  }

  @Post('providers')
  @RequirePermissions(Permission.AI_CONFIG_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a provider configuration; the key is encrypted at rest. The first one becomes the default',
  })
  @ApiZodBody(createAiProviderConfigSchema)
  @ApiZodResponse(aiProviderConfigSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, CONFLICT)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createAiProviderConfigSchema)) body: CreateAiProviderConfigRequest,
    @Req() req: AppRequest,
  ) {
    return this.providers.create(tenant, body, requestMeta(req));
  }

  @Get('models')
  @RequirePermissions(Permission.AI_CONFIG_READ)
  @ApiOperation({ summary: 'Static catalogue of models the platform can drive' })
  @ApiZodQuery(listModelsQuerySchema)
  @ApiZodResponse(aiModelInfoSchema.array())
  @ApiErrors(...COMMON_TENANT_ERRORS)
  listModels(@Query(new ZodValidationPipe(listModelsQuerySchema)) query: ListModelsQuery) {
    return this.providers.listModels(query.provider);
  }

  @Get('providers/:id')
  @RequirePermissions(Permission.AI_CONFIG_READ)
  @ApiOperation({ summary: 'Get a provider configuration' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(aiProviderConfigSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.providers.get(tenant, id);
  }

  @Patch('providers/:id')
  @RequirePermissions(Permission.AI_CONFIG_MANAGE)
  @ApiOperation({
    summary: 'Update a provider configuration (rotate or clear the key, set default)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateAiProviderConfigSchema)
  @ApiZodResponse(aiProviderConfigSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateAiProviderConfigSchema)) body: UpdateAiProviderConfigRequest,
    @Req() req: AppRequest,
  ) {
    return this.providers.update(tenant, id, body, requestMeta(req));
  }

  @Delete('providers/:id')
  @RequirePermissions(Permission.AI_CONFIG_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a provider configuration (409 while agents still use it)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.providers.remove(tenant, id, requestMeta(req));
  }

  @Post('providers/:id/health')
  @RequirePermissions(Permission.AI_CONFIG_MANAGE)
  @HttpCode(HttpStatus.OK)
  @RequestTimeout(90_000)
  @ApiOperation({ summary: 'Validate credentials/connectivity with a cheap provider call' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(aiHealthCheckResultSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  health(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.providers.healthCheck(tenant, id);
  }
}
