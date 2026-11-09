import {
  type CreateContactRequest,
  ErrorCode,
  type ListContactsQuery,
  Permission,
  type UpdateContactRequest,
  contactDetailSchema,
  contactSchema,
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
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
import { ContactsService } from './contacts.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];

@ApiTags('contacts')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions(Permission.CONTACTS_READ)
  @ApiOperation({ summary: 'List contacts (search, tag, owner filters; soft-deleted excluded)' })
  @ApiZodQuery(listContactsQuerySchema)
  @ApiZodResponse(contactSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listContactsQuerySchema)) query: ListContactsQuery,
  ) {
    return this.contacts.list(tenant, query);
  }

  @Get('tags')
  @RequirePermissions(Permission.CONTACTS_READ)
  @ApiOperation({ summary: 'Distinct tags used by the organization’s contacts' })
  @ApiZodResponse(z.array(z.string()))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  tags(@Tenant() tenant: TenantContext) {
    return this.contacts.tags(tenant);
  }

  @Post()
  @RequirePermissions(Permission.CONTACTS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a contact' })
  @ApiZodBody(createContactSchema)
  @ApiZodResponse(contactSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createContactSchema)) body: CreateContactRequest,
    @Req() req: AppRequest,
  ) {
    return this.contacts.create(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.CONTACTS_READ)
  @ApiOperation({ summary: 'Get a contact with its owner and relationship counts' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(contactDetailSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.contacts.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CONTACTS_UPDATE)
  @ApiOperation({ summary: 'Update a contact' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateContactSchema)
  @ApiZodResponse(contactSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateContactSchema)) body: UpdateContactRequest,
    @Req() req: AppRequest,
  ) {
    return this.contacts.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.CONTACTS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a contact' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.contacts.softDelete(tenant, id, requestMeta(req));
  }
}
