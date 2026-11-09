import {
  AGENT_HARD_LIMITS,
  type CreateAgentRequest,
  ErrorCode,
  type ExecuteAgentRequest,
  type ListAgentExecutionsQuery,
  type ListAgentsQuery,
  Permission,
  type UpdateAgentRequest,
  agentExecutionDetailSchema,
  agentExecutionSchema,
  agentSchema,
  createAgentSchema,
  executeAgentSchema,
  listAgentExecutionsQuerySchema,
  listAgentsQuerySchema,
  updateAgentSchema,
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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';

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
import { AgentExecutionsService } from './agent-executions.service';
import { AgentsService } from './agents.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];

/** Sync executions are capped by the runner at `syncModeMaxDurationMs`; leave room for persistence. */
const SYNC_EXECUTE_TIMEOUT_MS = AGENT_HARD_LIMITS.syncModeMaxDurationMs + 15_000;

/**
 * Agents and their executions. The `executions` routes are declared before the `:id` routes so that
 * Express never tries to parse "executions" as an agent id.
 */
@ApiTags('agents')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly executions: AgentExecutionsService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Executions
  // ---------------------------------------------------------------------------------------------

  @Get('executions')
  @RequirePermissions(Permission.AGENTS_READ)
  @ApiOperation({ summary: 'List agent executions (filter by agent, status, trigger, rootOnly)' })
  @ApiZodQuery(listAgentExecutionsQuerySchema)
  @ApiZodResponse(agentExecutionSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  listExecutions(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listAgentExecutionsQuerySchema)) query: ListAgentExecutionsQuery,
  ) {
    return this.executions.list(tenant, query);
  }

  @Get('executions/:id')
  @RequirePermissions(Permission.AGENTS_READ)
  @ApiOperation({ summary: 'Execution detail with ordered steps and child executions' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(agentExecutionDetailSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  getExecution(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.executions.detail(tenant, id);
  }

  @Post('executions/:id/cancel')
  @RequirePermissions(Permission.AGENTS_EXECUTE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel an execution: queued → cancelled now; running → cooperative request; finished → 409',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(agentExecutionSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  cancelExecution(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.executions.cancel(tenant, id, requestMeta(req));
  }

  // ---------------------------------------------------------------------------------------------
  // Agents
  // ---------------------------------------------------------------------------------------------

  @Get()
  @RequirePermissions(Permission.AGENTS_READ)
  @ApiOperation({ summary: 'List agents' })
  @ApiZodQuery(listAgentsQuerySchema)
  @ApiZodResponse(agentSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listAgentsQuerySchema)) query: ListAgentsQuery,
  ) {
    return this.agents.list(tenant, query);
  }

  @Post()
  @RequirePermissions(Permission.AGENTS_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an agent (tools must exist in the catalogue; unique name per org)',
  })
  @ApiZodBody(createAgentSchema)
  @ApiZodResponse(agentSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, CONFLICT)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createAgentSchema)) body: CreateAgentRequest,
    @Req() req: AppRequest,
  ) {
    return this.agents.create(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.AGENTS_READ)
  @ApiOperation({ summary: 'Get an agent' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(agentSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.agents.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.AGENTS_MANAGE)
  @ApiOperation({ summary: 'Update an agent' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateAgentSchema)
  @ApiZodResponse(agentSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateAgentSchema)) body: UpdateAgentRequest,
    @Req() req: AppRequest,
  ) {
    return this.agents.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.AGENTS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an agent (409 while executions are queued/running)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.agents.remove(tenant, id, requestMeta(req));
  }

  @Post(':id/execute')
  @RequirePermissions(Permission.AGENTS_EXECUTE)
  @RequestTimeout(SYNC_EXECUTE_TIMEOUT_MS)
  @ApiOperation({
    summary:
      'Execute an agent: mode=async (default) enqueues and answers 202 with the queued execution; mode=sync runs inline (capped) and answers 200 with the finished execution detail',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(executeAgentSchema)
  @ApiZodResponse(agentExecutionSchema, {
    status: HttpStatus.ACCEPTED,
    description: 'Queued (async)',
  })
  @ApiZodResponse(agentExecutionDetailSchema, {
    status: HttpStatus.OK,
    description: 'Finished (sync)',
  })
  @ApiErrors(
    ...COMMON_TENANT_ERRORS,
    NOT_FOUND,
    [HttpStatus.PAYMENT_REQUIRED, ErrorCode.ENTITLEMENT_EXCEEDED],
    [HttpStatus.CONFLICT, ErrorCode.CONFLICT, ErrorCode.AI_NOT_CONFIGURED],
  )
  async execute(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(executeAgentSchema)) body: ExecuteAgentRequest,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const outcome = await this.executions.execute(tenant, id, body, requestMeta(req));
    res.status(outcome.mode === 'async' ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return outcome.execution;
  }
}
