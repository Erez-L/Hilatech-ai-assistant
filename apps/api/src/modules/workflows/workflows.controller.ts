import {
  type CreateWorkflowRequest,
  ErrorCode,
  type ListWorkflowExecutionsQuery,
  type ListWorkflowsQuery,
  Permission,
  type RunWorkflowRequest,
  type UpdateWorkflowRequest,
  type ValidateWorkflowRequest,
  createWorkflowSchema,
  listWorkflowExecutionsQuerySchema,
  listWorkflowsQuerySchema,
  runWorkflowSchema,
  updateWorkflowSchema,
  validateWorkflowSchema,
  workflowExecutionSchema,
  workflowSchema,
  workflowTemplateSchema,
  workflowValidationResultSchema,
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
import { WorkflowsService } from './workflows.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];

@ApiTags('workflows')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('templates')
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @ApiOperation({ summary: 'Ready-made workflow templates (copy into POST /workflows)' })
  @ApiZodResponse(z.array(workflowTemplateSchema))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  templates() {
    return this.workflows.templates();
  }

  @Post('validate')
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a workflow definition without storing it' })
  @ApiZodBody(validateWorkflowSchema)
  @ApiZodResponse(workflowValidationResultSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  validate(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(validateWorkflowSchema)) body: ValidateWorkflowRequest,
  ) {
    return this.workflows.validate(tenant, body);
  }

  @Get()
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @ApiOperation({ summary: 'List workflows' })
  @ApiZodQuery(listWorkflowsQuerySchema)
  @ApiZodResponse(workflowSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listWorkflowsQuerySchema)) query: ListWorkflowsQuery,
  ) {
    return this.workflows.list(tenant, query);
  }

  @Post()
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a workflow; an enabled workflow is validated first (400 with details.issues)',
  })
  @ApiZodBody(createWorkflowSchema)
  @ApiZodResponse(workflowSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, CONFLICT)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createWorkflowSchema)) body: CreateWorkflowRequest,
    @Req() req: AppRequest,
  ) {
    return this.workflows.create(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @ApiOperation({ summary: 'Get a workflow' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(workflowSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.workflows.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @ApiOperation({ summary: 'Update a workflow (the resulting definition must be valid if it is enabled)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateWorkflowSchema)
  @ApiZodResponse(workflowSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateWorkflowSchema)) body: UpdateWorkflowRequest,
    @Req() req: AppRequest,
  ) {
    return this.workflows.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a workflow and its executions' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.workflows.remove(tenant, id, requestMeta(req));
  }

  @Post(':id/enable')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate and enable a workflow' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(workflowSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  enable(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string, @Req() req: AppRequest) {
    return this.workflows.setEnabled(tenant, id, true, requestMeta(req));
  }

  @Post(':id/disable')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable a workflow (running executions finish; no new ones start)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(workflowSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  disable(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string, @Req() req: AppRequest) {
    return this.workflows.setEnabled(tenant, id, false, requestMeta(req));
  }

  @Post(':id/run')
  @RequirePermissions(Permission.AUTOMATIONS_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Run an enabled workflow now; returns the queued execution (202)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(runWorkflowSchema)
  @ApiZodResponse(workflowExecutionSchema, { status: HttpStatus.ACCEPTED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  run(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(runWorkflowSchema)) body: RunWorkflowRequest,
    @Req() req: AppRequest,
  ) {
    return this.workflows.run(tenant, id, body, requestMeta(req));
  }
}

@ApiTags('workflows')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('workflow-executions')
export class WorkflowExecutionsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @ApiOperation({ summary: 'List workflow executions (filter by workflowId / status)' })
  @ApiZodQuery(listWorkflowExecutionsQuerySchema)
  @ApiZodResponse(workflowExecutionSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listWorkflowExecutionsQuerySchema)) query: ListWorkflowExecutionsQuery,
  ) {
    return this.workflows.listExecutions(tenant, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.AUTOMATIONS_READ)
  @ApiOperation({ summary: 'Execution detail with per-step results' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(workflowExecutionSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.workflows.getExecution(tenant, id);
  }
}
