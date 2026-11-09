import {
  type AssignLeadRequest,
  type ConvertLeadRequest,
  type CreateLeadRequest,
  ErrorCode,
  type ListLeadsQuery,
  type PaginationQuery,
  Permission,
  type UpdateLeadRequest,
  assignLeadSchema,
  contactSchema,
  convertLeadSchema,
  createLeadNoteSchema,
  createLeadSchema,
  leadActivityWithActorSchema,
  leadNoteWithAuthorSchema,
  leadWithRelationsSchema,
  listLeadsQuerySchema,
  paginationQuerySchema,
  updateLeadSchema,
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
import { LeadsService } from './leads.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];

/** TODO(contracts): add `convertLeadResultSchema` to `@hilatech/contracts/crm`. */
const convertLeadResultSchema = z.object({
  lead: leadWithRelationsSchema,
  contact: contactSchema,
});

type CreateLeadNoteRequest = z.infer<typeof createLeadNoteSchema>;

@ApiTags('leads')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermissions(Permission.LEADS_READ)
  @ApiOperation({ summary: 'List leads with contact and assignee summaries' })
  @ApiZodQuery(listLeadsQuerySchema)
  @ApiZodResponse(leadWithRelationsSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listLeadsQuerySchema)) query: ListLeadsQuery,
  ) {
    return this.leads.list(tenant, query);
  }

  @Post()
  @RequirePermissions(Permission.LEADS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a lead (assigning to someone else requires leads:assign)' })
  @ApiZodBody(createLeadSchema)
  @ApiZodResponse(leadWithRelationsSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createLeadSchema)) body: CreateLeadRequest,
    @Req() req: AppRequest,
  ) {
    return this.leads.create(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.LEADS_READ)
  @ApiOperation({ summary: 'Get a lead' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(leadWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.leads.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.LEADS_UPDATE)
  @ApiOperation({
    summary:
      'Update a lead; records status_changed / value_changed / contact_linked / assigned / updated activities',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateLeadSchema)
  @ApiZodResponse(leadWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateLeadSchema)) body: UpdateLeadRequest,
    @Req() req: AppRequest,
  ) {
    return this.leads.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.LEADS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a lead' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.leads.softDelete(tenant, id, requestMeta(req));
  }

  @Post(':id/assign')
  @RequirePermissions(Permission.LEADS_ASSIGN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign (or unassign with null) a lead; notifies the assignee' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(assignLeadSchema)
  @ApiZodResponse(leadWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  assign(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(assignLeadSchema)) body: AssignLeadRequest,
    @Req() req: AppRequest,
  ) {
    return this.leads.assign(tenant, id, body, requestMeta(req));
  }

  @Post(':id/convert')
  @RequirePermissions(Permission.LEADS_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Convert a lead: link or create a contact, optionally mark it won' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(convertLeadSchema)
  @ApiZodResponse(convertLeadResultSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  convert(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(convertLeadSchema)) body: ConvertLeadRequest,
    @Req() req: AppRequest,
  ) {
    return this.leads.convert(tenant, id, body, requestMeta(req));
  }

  @Get(':id/notes')
  @RequirePermissions(Permission.LEADS_READ)
  @ApiOperation({ summary: 'Notes of a lead, newest first' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(leadNoteWithAuthorSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  listNotes(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.leads.listNotes(tenant, id, query);
  }

  @Post(':id/notes')
  @RequirePermissions(Permission.LEADS_UPDATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a note to a lead' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(createLeadNoteSchema)
  @ApiZodResponse(leadNoteWithAuthorSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  addNote(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(createLeadNoteSchema)) body: CreateLeadNoteRequest,
    @Req() req: AppRequest,
  ) {
    return this.leads.addNote(tenant, id, body.body, requestMeta(req));
  }

  @Delete(':id/notes/:noteId')
  @RequirePermissions(Permission.LEADS_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a note (author, or a member with leads:delete)' })
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
    await this.leads.deleteNote(tenant, id, noteId, requestMeta(req));
  }

  @Get(':id/activities')
  @RequirePermissions(Permission.LEADS_READ)
  @ApiOperation({ summary: 'Activity timeline of a lead, newest first' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(leadActivityWithActorSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  listActivities(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.leads.listActivities(tenant, id, query);
  }
}
