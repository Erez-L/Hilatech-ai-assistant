import {
  type CreateOrganizationRequest,
  ErrorCode,
  type OrganizationSettings,
  Permission,
  type UpdateOrganizationRequest,
  createOrganizationSchema,
  organizationSchema,
  organizationSettingsSchema,
  organizationSummarySchema,
  updateOrganizationSchema,
} from '@hilatech/contracts';
import { type Principal, type TenantContext } from '@hilatech/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser, NoTenant, Req, RequirePermissions, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodResponse,
  COMMON_AUTH_ERRORS,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { type AppRequest, requestMeta } from '../../common/request';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post()
  @NoTenant()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an organization (caller becomes owner)' })
  @ApiZodBody(createOrganizationSchema)
  @ApiZodResponse(organizationSchema, { status: HttpStatus.CREATED })
  @ApiErrors(
    ...COMMON_AUTH_ERRORS,
    [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR],
    [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
  )
  create(
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(createOrganizationSchema)) body: CreateOrganizationRequest,
    @Req() req: AppRequest,
  ) {
    return this.organizations.create(principal, body, requestMeta(req));
  }

  @Get()
  @NoTenant()
  @ApiOperation({ summary: "List the caller's organizations" })
  @ApiZodResponse(z.array(organizationSummarySchema))
  @ApiErrors(...COMMON_AUTH_ERRORS)
  listMine(@CurrentUser() principal: Principal) {
    return this.organizations.listForUser(principal.userId);
  }

  @Get('current')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_READ)
  @ApiOperation({ summary: 'Get the selected organization' })
  @ApiZodResponse(organizationSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  current(@Tenant() tenant: TenantContext) {
    return this.organizations.getCurrent(tenant);
  }

  @Patch('current')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_UPDATE)
  @ApiOperation({ summary: 'Update the selected organization' })
  @ApiZodBody(updateOrganizationSchema)
  @ApiZodResponse(organizationSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, [HttpStatus.CONFLICT, ErrorCode.CONFLICT])
  update(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(updateOrganizationSchema)) body: UpdateOrganizationRequest,
    @Req() req: AppRequest,
  ) {
    return this.organizations.update(tenant, body, requestMeta(req));
  }

  @Delete('current')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete the selected organization (owner only)' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  async remove(@Tenant() tenant: TenantContext, @Req() req: AppRequest): Promise<void> {
    await this.organizations.softDelete(tenant, requestMeta(req));
  }

  @Get('current/settings')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_READ)
  @ApiOperation({ summary: 'Get organization settings' })
  @ApiZodResponse(organizationSettingsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  settings(@Tenant() tenant: TenantContext) {
    return this.organizations.getSettings(tenant);
  }

  @Put('current/settings')
  @ApiSecurity('organization')
  @RequirePermissions(Permission.ORG_UPDATE)
  @ApiOperation({ summary: 'Replace organization settings' })
  @ApiZodBody(organizationSettingsSchema)
  @ApiZodResponse(organizationSettingsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS)
  replaceSettings(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(organizationSettingsSchema)) body: OrganizationSettings,
    @Req() req: AppRequest,
  ) {
    return this.organizations.replaceSettings(tenant, body, requestMeta(req));
  }
}
