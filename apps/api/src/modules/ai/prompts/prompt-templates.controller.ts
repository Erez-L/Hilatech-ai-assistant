import {
  type CreatePromptTemplateRequest,
  ErrorCode,
  type PaginationQuery,
  Permission,
  type RenderPromptTemplateRequest,
  type UpdatePromptTemplateRequest,
  createPromptTemplateSchema,
  paginationQuerySchema,
  promptTemplateSchema,
  renderPromptTemplateSchema,
  updatePromptTemplateSchema,
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

import { Req, RequirePermissions, Tenant } from '../../../common/decorators';
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
import { PromptTemplatesService } from './prompt-templates.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];

const renderedPromptSchema = z.object({ rendered: z.string(), missing: z.array(z.string()) });

@ApiTags('ai')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('ai/prompts')
export class PromptTemplatesController {
  constructor(private readonly prompts: PromptTemplatesService) {}

  @Get()
  @RequirePermissions(Permission.AI_CONFIG_READ)
  @ApiOperation({ summary: 'List prompt templates' })
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(promptTemplateSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.prompts.list(tenant, query);
  }

  @Post()
  @RequirePermissions(Permission.AI_CONFIG_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a prompt template ({{variables}} are extracted automatically)' })
  @ApiZodBody(createPromptTemplateSchema)
  @ApiZodResponse(promptTemplateSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, CONFLICT)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createPromptTemplateSchema)) body: CreatePromptTemplateRequest,
    @Req() req: AppRequest,
  ) {
    return this.prompts.create(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.AI_CONFIG_READ)
  @ApiOperation({ summary: 'Get a prompt template' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(promptTemplateSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.prompts.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.AI_CONFIG_MANAGE)
  @ApiOperation({ summary: 'Update a prompt template (content changes bump the version)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updatePromptTemplateSchema)
  @ApiZodResponse(promptTemplateSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updatePromptTemplateSchema)) body: UpdatePromptTemplateRequest,
    @Req() req: AppRequest,
  ) {
    return this.prompts.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.AI_CONFIG_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a prompt template (system templates → 409)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.prompts.remove(tenant, id, requestMeta(req));
  }

  @Post(':id/render')
  @RequirePermissions(Permission.AI_CONFIG_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Render a template with variables; unresolved placeholders are listed' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(renderPromptTemplateSchema)
  @ApiZodResponse(renderedPromptSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  render(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(renderPromptTemplateSchema)) body: RenderPromptTemplateRequest,
  ) {
    return this.prompts.render(tenant, id, body);
  }
}
