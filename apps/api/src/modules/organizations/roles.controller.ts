import {
  type CreateRoleRequest,
  ErrorCode,
  Permission,
  type UpdateRoleRequest,
  createRoleSchema,
  roleSchema,
  updateRoleSchema,
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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Req, RequirePermissions, Tenant } from '../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { type AppRequest, requestMeta } from '../../common/request';
import { RolesService } from './roles.service';

const permissionCatalogEntrySchema = z.object({
  key: z.string(),
  group: z.string(),
  description: z.string().nullable(),
});

@ApiTags('roles')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions(Permission.ROLES_READ)
  @ApiOperation({ summary: 'Permission catalog' })
  @ApiZodResponse(z.array(permissionCatalogEntrySchema))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  permissions() {
    return this.roles.permissionCatalog();
  }

  @Get('roles')
  @RequirePermissions(Permission.ROLES_READ)
  @ApiOperation({ summary: 'List roles of the organization' })
  @ApiZodResponse(z.array(roleSchema))
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(@Tenant() tenant: TenantContext) {
    return this.roles.list(tenant);
  }

  @Post('roles')
  @RequirePermissions(Permission.ROLES_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a custom role' })
  @ApiZodBody(createRoleSchema)
  @ApiZodResponse(roleSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, [HttpStatus.CONFLICT, ErrorCode.CONFLICT])
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleRequest,
    @Req() req: AppRequest,
  ) {
    return this.roles.create(tenant, body, requestMeta(req));
  }

  @Get('roles/:id')
  @RequirePermissions(Permission.ROLES_READ)
  @ApiOperation({ summary: 'Get a role' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(roleSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND])
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.roles.get(tenant, id);
  }

  @Patch('roles/:id')
  @RequirePermissions(Permission.ROLES_MANAGE)
  @ApiOperation({
    summary: 'Update a role (system roles: permissions only, owner cannot be reduced)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateRoleSchema)
  @ApiZodResponse(roleSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND])
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleRequest,
    @Req() req: AppRequest,
  ) {
    return this.roles.update(tenant, id, body, requestMeta(req));
  }

  @Delete('roles/:id')
  @RequirePermissions(Permission.ROLES_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom role without members' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(
    ...COMMON_TENANT_ERRORS,
    [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
    [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
  )
  async remove(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.roles.remove(tenant, id, requestMeta(req));
  }
}
