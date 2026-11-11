import {
  type BulkAssignTasksRequest,
  type CreateTaskRequest,
  ErrorCode,
  type ListTasksQuery,
  Permission,
  type UpdateTaskRequest,
  bulkAssignTasksResultSchema,
  bulkAssignTasksSchema,
  createTaskSchema,
  listTasksQuerySchema,
  taskWithRelationsSchema,
  updateTaskSchema,
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
import { TasksService } from './tasks.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];

@ApiTags('tasks')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions(Permission.TASKS_READ)
  @ApiOperation({
    summary: 'List tasks (filters: status, assignee, due range, overdue, related entity)',
  })
  @ApiZodQuery(listTasksQuerySchema)
  @ApiZodResponse(taskWithRelationsSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listTasksQuerySchema)) query: ListTasksQuery,
  ) {
    return this.tasks.list(tenant, query);
  }

  @Post()
  @RequirePermissions(Permission.TASKS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a task (assigning to someone else requires tasks:assign)' })
  @ApiZodBody(createTaskSchema)
  @ApiZodResponse(taskWithRelationsSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskRequest,
    @Req() req: AppRequest,
  ) {
    return this.tasks.create(tenant, body, requestMeta(req));
  }

  @Post('bulk-assign')
  @RequirePermissions(Permission.TASKS_ASSIGN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign (or unassign with null) up to 100 tasks at once' })
  @ApiZodBody(bulkAssignTasksSchema)
  @ApiZodResponse(bulkAssignTasksResultSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  bulkAssign(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(bulkAssignTasksSchema)) body: BulkAssignTasksRequest,
    @Req() req: AppRequest,
  ) {
    return this.tasks.bulkAssign(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.TASKS_READ)
  @ApiOperation({ summary: 'Get a task' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(taskWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.tasks.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.TASKS_UPDATE)
  @ApiOperation({
    summary: 'Update a task; null clears dueAt, reminderAt, assignee and related ids',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateTaskSchema)
  @ApiZodResponse(taskWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskRequest,
    @Req() req: AppRequest,
  ) {
    return this.tasks.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.TASKS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.tasks.remove(tenant, id, requestMeta(req));
  }

  @Post(':id/complete')
  @RequirePermissions(Permission.TASKS_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a task done (idempotent); emits task.completed once' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(taskWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  complete(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.tasks.complete(tenant, id, requestMeta(req));
  }

  @Post(':id/reopen')
  @RequirePermissions(Permission.TASKS_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reopen a done or cancelled task (back to todo)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(taskWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  reopen(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.tasks.reopen(tenant, id, requestMeta(req));
  }
}
