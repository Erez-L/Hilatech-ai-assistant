import {
  type AssociateContactsRequest,
  type CreateCompanyRequest,
  ErrorCode,
  type ListCompaniesQuery,
  type PaginationQuery,
  Permission,
  type UpdateCompanyRequest,
  associateContactsResultSchema,
  associateContactsSchema,
  companyDetailSchema,
  companySchema,
  contactSchema,
  createCompanySchema,
  listCompaniesQuerySchema,
  paginationQuerySchema,
  updateCompanySchema,
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
import { CompaniesService } from './companies.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];

@ApiTags('companies')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermissions(Permission.COMPANIES_READ)
  @ApiOperation({ summary: 'List companies (search matches name or domain)' })
  @ApiZodQuery(listCompaniesQuerySchema)
  @ApiZodResponse(companySchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listCompaniesQuerySchema)) query: ListCompaniesQuery,
  ) {
    return this.companies.list(tenant, query);
  }

  @Post()
  @RequirePermissions(Permission.COMPANIES_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a company' })
  @ApiZodBody(createCompanySchema)
  @ApiZodResponse(companySchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createCompanySchema)) body: CreateCompanyRequest,
    @Req() req: AppRequest,
  ) {
    return this.companies.create(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.COMPANIES_READ)
  @ApiOperation({ summary: 'Get a company with owner and contact/deal counts' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(companyDetailSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.companies.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.COMPANIES_UPDATE)
  @ApiOperation({ summary: 'Update a company' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateCompanySchema)
  @ApiZodResponse(companySchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateCompanySchema)) body: UpdateCompanyRequest,
    @Req() req: AppRequest,
  ) {
    return this.companies.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.COMPANIES_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a company (contacts and deals keep existing, unlinked)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.companies.remove(tenant, id, requestMeta(req));
  }

  @Get(':id/contacts')
  @RequirePermissions(Permission.COMPANIES_READ, Permission.CONTACTS_READ)
  @ApiOperation({ summary: 'Contacts associated with the company' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(contactSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  listContacts(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.companies.listContacts(tenant, id, query);
  }

  @Post(':id/contacts')
  @RequirePermissions(Permission.COMPANIES_UPDATE, Permission.CONTACTS_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Associate existing contacts with the company' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(associateContactsSchema)
  @ApiZodResponse(associateContactsResultSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  associate(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(associateContactsSchema)) body: AssociateContactsRequest,
    @Req() req: AppRequest,
  ) {
    return this.companies.associateContacts(tenant, id, body, requestMeta(req));
  }

  @Delete(':id/contacts/:contactId')
  @RequirePermissions(Permission.COMPANIES_UPDATE, Permission.CONTACTS_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the association between a contact and the company' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async dissociate(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Param('contactId', UuidPipe) contactId: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.companies.dissociateContact(tenant, id, contactId, requestMeta(req));
  }
}
