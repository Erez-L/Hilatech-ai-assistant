import {
  type BoardQuery,
  type CreateDealNoteRequest,
  type CreateDealRequest,
  type DealConversionQuery,
  ErrorCode,
  type ListDealsQuery,
  type MoveDealRequest,
  type PaginationQuery,
  Permission,
  type UpdateDealRequest,
  boardQuerySchema,
  createDealNoteSchema,
  createDealSchema,
  dealActivityWithActorSchema,
  dealBoardSchema,
  dealConversionQuerySchema,
  dealConversionReportSchema,
  dealNoteWithAuthorSchema,
  dealWithRelationsSchema,
  listDealsQuerySchema,
  moveDealSchema,
  paginationQuerySchema,
  updateDealSchema,
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
import { DealsService } from './deals.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];

@ApiTags('deals')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('deals')
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermissions(Permission.DEALS_READ)
  @ApiOperation({ summary: 'List deals with filters, search, pagination and sorting' })
  @ApiZodQuery(listDealsQuerySchema)
  @ApiZodResponse(dealWithRelationsSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listDealsQuerySchema)) query: ListDealsQuery,
  ) {
    return this.deals.list(tenant, query);
  }

  @Post()
  @RequirePermissions(Permission.DEALS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a deal (default pipeline / first open stage unless given)' })
  @ApiZodBody(createDealSchema)
  @ApiZodResponse(dealWithRelationsSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createDealSchema)) body: CreateDealRequest,
    @Req() req: AppRequest,
  ) {
    return this.deals.create(tenant, body, requestMeta(req));
  }

  // Static routes must precede ':id'.

  @Get('board')
  @RequirePermissions(Permission.DEALS_READ)
  @ApiOperation({
    summary:
      'Kanban board: one column per stage of the pipeline with its deals (ordered by position), counts and per-currency totals',
  })
  @ApiZodQuery(boardQuerySchema)
  @ApiZodResponse(dealBoardSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  board(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(boardQuerySchema)) query: BoardQuery,
  ) {
    return this.deals.board(tenant, query);
  }

  @Get('reports/conversion')
  @RequirePermissions(Permission.DEALS_READ, Permission.ANALYTICS_READ)
  @ApiOperation({
    summary: 'Stage conversion, win rate, average sales cycle and value by stage for one pipeline',
  })
  @ApiZodQuery(dealConversionQuerySchema)
  @ApiZodResponse(dealConversionReportSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  conversion(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(dealConversionQuerySchema)) query: DealConversionQuery,
  ) {
    return this.deals.conversion(tenant, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.DEALS_READ)
  @ApiOperation({ summary: 'Get a deal' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(dealWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.deals.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DEALS_UPDATE)
  @ApiOperation({ summary: 'Update a deal (stage changes use POST /deals/:id/move)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateDealSchema)
  @ApiZodResponse(dealWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateDealSchema)) body: UpdateDealRequest,
    @Req() req: AppRequest,
  ) {
    return this.deals.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.DEALS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a deal' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.deals.remove(tenant, id, requestMeta(req));
  }

  @Post(':id/move')
  @RequirePermissions(Permission.DEALS_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Move a deal to a stage and position of its pipeline (Kanban drop). Won/lost stages close the deal; moving back reopens it. Emits deal.stage_changed (+ deal.won / deal.lost).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(moveDealSchema)
  @ApiZodResponse(dealWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  move(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(moveDealSchema)) body: MoveDealRequest,
    @Req() req: AppRequest,
  ) {
    return this.deals.move(tenant, id, body, requestMeta(req));
  }

  @Get(':id/notes')
  @RequirePermissions(Permission.DEALS_READ)
  @ApiOperation({ summary: 'Notes of a deal, newest first' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(dealNoteWithAuthorSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  listNotes(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.deals.listNotes(tenant, id, query);
  }

  @Post(':id/notes')
  @RequirePermissions(Permission.DEALS_UPDATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a note to a deal' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(createDealNoteSchema)
  @ApiZodResponse(dealNoteWithAuthorSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  addNote(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(createDealNoteSchema)) body: CreateDealNoteRequest,
    @Req() req: AppRequest,
  ) {
    return this.deals.addNote(tenant, id, body.body, requestMeta(req));
  }

  @Delete(':id/notes/:noteId')
  @RequirePermissions(Permission.DEALS_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a note (author, or a member with deals:delete)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'noteId', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async deleteNote(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Param('noteId', UuidPipe) noteId: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.deals.deleteNote(tenant, id, noteId, requestMeta(req));
  }

  @Get(':id/activities')
  @RequirePermissions(Permission.DEALS_READ)
  @ApiOperation({ summary: 'Activity timeline of a deal, newest first' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(dealActivityWithActorSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  listActivities(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.deals.listActivities(tenant, id, query);
  }
}
