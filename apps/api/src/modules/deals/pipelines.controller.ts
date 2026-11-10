import {
  type CreatePipelineRequest,
  type CreateStageRequest,
  type DeleteStageQuery,
  ErrorCode,
  Permission,
  type ReorderStagesRequest,
  type UpdatePipelineRequest,
  type UpdateStageRequest,
  createPipelineSchema,
  createStageSchema,
  deleteStageQuerySchema,
  pipelineSchema,
  reorderStagesSchema,
  updatePipelineSchema,
  updateStageSchema,
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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Req, RequirePermissions, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { type AppRequest, requestMeta } from '../../common/request';
import { PipelinesService } from './pipelines.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];

@ApiTags('pipelines')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get()
  @RequirePermissions(Permission.DEALS_READ)
  @ApiOperation({ summary: 'List pipelines with their ordered stages and deal counts (default pipeline first)' })
  @ApiZodResponse(z.array(pipelineSchema))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(@Tenant() tenant: TenantContext) {
    return this.pipelines.list(tenant);
  }

  @Post()
  @RequirePermissions(Permission.PIPELINES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a pipeline (default stages unless given; needs one open, one won, one lost stage)' })
  @ApiZodBody(createPipelineSchema)
  @ApiZodResponse(pipelineSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, CONFLICT)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createPipelineSchema)) body: CreatePipelineRequest,
    @Req() req: AppRequest,
  ) {
    return this.pipelines.create(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.DEALS_READ)
  @ApiOperation({ summary: 'Get a pipeline' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(pipelineSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.pipelines.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PIPELINES_MANAGE)
  @ApiOperation({ summary: 'Rename a pipeline or make it the default' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updatePipelineSchema)
  @ApiZodResponse(pipelineSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updatePipelineSchema)) body: UpdatePipelineRequest,
    @Req() req: AppRequest,
  ) {
    return this.pipelines.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.PIPELINES_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an empty, non-default pipeline' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.pipelines.remove(tenant, id, requestMeta(req));
  }

  @Post(':id/stages')
  @RequirePermissions(Permission.PIPELINES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a stage; returns the updated pipeline' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(createStageSchema)
  @ApiZodResponse(pipelineSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  createStage(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(createStageSchema)) body: CreateStageRequest,
    @Req() req: AppRequest,
  ) {
    return this.pipelines.createStage(tenant, id, body, requestMeta(req));
  }

  @Put(':id/stages/order')
  @RequirePermissions(Permission.PIPELINES_MANAGE)
  @ApiOperation({ summary: 'Reorder stages: send every stage id in the new display order' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(reorderStagesSchema)
  @ApiZodResponse(pipelineSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  reorder(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(reorderStagesSchema)) body: ReorderStagesRequest,
    @Req() req: AppRequest,
  ) {
    return this.pipelines.reorderStages(tenant, id, body, requestMeta(req));
  }

  @Patch(':id/stages/:stageId')
  @RequirePermissions(Permission.PIPELINES_MANAGE)
  @ApiOperation({ summary: 'Rename a stage or change its probability / kind (deals follow the kind)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'stageId', format: 'uuid' })
  @ApiZodBody(updateStageSchema)
  @ApiZodResponse(pipelineSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  updateStage(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Param('stageId', UuidPipe) stageId: string,
    @Body(new ZodValidationPipe(updateStageSchema)) body: UpdateStageRequest,
    @Req() req: AppRequest,
  ) {
    return this.pipelines.updateStage(tenant, id, stageId, body, requestMeta(req));
  }

  @Delete(':id/stages/:stageId')
  @RequirePermissions(Permission.PIPELINES_MANAGE)
  @ApiOperation({
    summary: 'Delete a stage; a stage holding deals needs ?moveDealsToStageId=<stage of the same pipeline>',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'stageId', format: 'uuid' })
  @ApiZodQuery(deleteStageQuerySchema)
  @ApiZodResponse(pipelineSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  deleteStage(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Param('stageId', UuidPipe) stageId: string,
    @Query(new ZodValidationPipe(deleteStageQuerySchema)) query: DeleteStageQuery,
    @Req() req: AppRequest,
  ) {
    return this.pipelines.deleteStage(tenant, id, stageId, query, requestMeta(req));
  }
}
