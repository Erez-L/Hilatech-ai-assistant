import {
  type CreateEvaluationCaseRequest,
  type CreateEvaluationDatasetRequest,
  ErrorCode,
  type ListEvaluationRunsQuery,
  Permission,
  type StartEvaluationRunRequest,
  type UpdateEvaluationCaseRequest,
  type UpdateEvaluationDatasetRequest,
  createEvaluationCaseSchema,
  createEvaluationDatasetSchema,
  evaluationCaseSchema,
  evaluationDatasetDetailSchema,
  evaluationDatasetSchema,
  evaluationRunDetailSchema,
  evaluationRunSchema,
  listEvaluationRunsQuerySchema,
  startEvaluationRunSchema,
  updateEvaluationCaseSchema,
  updateEvaluationDatasetSchema,
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
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
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
import { EvaluationsService } from './evaluations.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];
const INVALID: [number, ...ErrorCode[]] = [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR];

/** Agent evaluation datasets, cases and runs. `runs` routes are declared before `datasets/:id`. */
@ApiTags('evaluations')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('evaluations')
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get('runs')
  @RequirePermissions(Permission.AGENTS_READ)
  @ApiOperation({ summary: 'List evaluation runs (filter by dataset or agent)' })
  @ApiZodQuery(listEvaluationRunsQuerySchema)
  @ApiZodResponse(evaluationRunSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  listRuns(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listEvaluationRunsQuerySchema)) query: ListEvaluationRunsQuery,
  ) {
    return this.evaluations.listRuns(tenant, query);
  }

  @Get('runs/:id')
  @RequirePermissions(Permission.AGENTS_READ)
  @ApiOperation({ summary: 'Run detail with the result of every case' })
  @ApiZodResponse(evaluationRunDetailSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  getRun(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.evaluations.getRun(tenant, id);
  }

  @Post('runs/:id/cancel')
  @RequirePermissions(Permission.AGENTS_EXECUTE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a queued or running evaluation run' })
  @ApiZodResponse(evaluationRunSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  cancelRun(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.evaluations.cancelRun(tenant, id);
  }

  @Get('datasets')
  @RequirePermissions(Permission.AGENTS_READ)
  @ApiOperation({ summary: 'List evaluation datasets with their case count and last run' })
  @ApiZodResponse(z.array(evaluationDatasetSchema))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  listDatasets(@Tenant() tenant: TenantContext) {
    return this.evaluations.listDatasets(tenant);
  }

  @Post('datasets')
  @RequirePermissions(Permission.AGENTS_MANAGE)
  @ApiOperation({ summary: 'Create an evaluation dataset' })
  @ApiZodBody(createEvaluationDatasetSchema)
  @ApiZodResponse(evaluationDatasetSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, INVALID)
  createDataset(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createEvaluationDatasetSchema))
    body: CreateEvaluationDatasetRequest,
    @Req() req: AppRequest,
  ) {
    return this.evaluations.createDataset(tenant, body, requestMeta(req));
  }

  @Get('datasets/:id')
  @RequirePermissions(Permission.AGENTS_READ)
  @ApiOperation({ summary: 'Dataset with its cases' })
  @ApiZodResponse(evaluationDatasetDetailSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  getDataset(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.evaluations.getDataset(tenant, id);
  }

  @Patch('datasets/:id')
  @RequirePermissions(Permission.AGENTS_MANAGE)
  @ApiOperation({ summary: 'Rename a dataset or change its description' })
  @ApiZodBody(updateEvaluationDatasetSchema)
  @ApiZodResponse(evaluationDatasetSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, INVALID)
  updateDataset(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateEvaluationDatasetSchema))
    body: UpdateEvaluationDatasetRequest,
  ) {
    return this.evaluations.updateDataset(tenant, id, body);
  }

  @Delete('datasets/:id')
  @RequirePermissions(Permission.AGENTS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a dataset with its cases, runs and results' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async deleteDataset(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.evaluations.deleteDataset(tenant, id, requestMeta(req));
  }

  @Post('datasets/:id/cases')
  @RequirePermissions(Permission.AGENTS_MANAGE)
  @ApiOperation({ summary: 'Add a case (input + checks) to a dataset' })
  @ApiZodBody(createEvaluationCaseSchema)
  @ApiZodResponse(evaluationCaseSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT, INVALID)
  addCase(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(createEvaluationCaseSchema)) body: CreateEvaluationCaseRequest,
  ) {
    return this.evaluations.addCase(tenant, id, body);
  }

  @Patch('datasets/:id/cases/:caseId')
  @RequirePermissions(Permission.AGENTS_MANAGE)
  @ApiOperation({ summary: 'Update a case' })
  @ApiZodBody(updateEvaluationCaseSchema)
  @ApiZodResponse(evaluationCaseSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, INVALID)
  updateCase(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Param('caseId', UuidPipe) caseId: string,
    @Body(new ZodValidationPipe(updateEvaluationCaseSchema)) body: UpdateEvaluationCaseRequest,
  ) {
    return this.evaluations.updateCase(tenant, id, caseId, body);
  }

  @Delete('datasets/:id/cases/:caseId')
  @RequirePermissions(Permission.AGENTS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a case (earlier results keep their snapshot)' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async deleteCase(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Param('caseId', UuidPipe) caseId: string,
  ): Promise<void> {
    await this.evaluations.deleteCase(tenant, id, caseId);
  }

  @Post('datasets/:id/runs')
  @RequirePermissions(Permission.AGENTS_EXECUTE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Run an agent against every case of the dataset (asynchronous)' })
  @ApiZodBody(startEvaluationRunSchema)
  @ApiZodResponse(evaluationRunSchema, { status: HttpStatus.ACCEPTED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT, INVALID)
  startRun(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(startEvaluationRunSchema)) body: StartEvaluationRunRequest,
    @Req() req: AppRequest,
  ) {
    return this.evaluations.startRun(tenant, id, body, requestMeta(req));
  }
}
