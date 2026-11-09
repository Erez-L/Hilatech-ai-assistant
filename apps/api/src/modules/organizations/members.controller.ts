import {
  ErrorCode,
  type PaginationQuery,
  Permission,
  type UpdateMemberRequest,
  memberSchema,
  paginationQuerySchema,
  updateMemberSchema,
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
import { MembersService } from './members.service';

@ApiTags('members')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermissions(Permission.MEMBERS_READ)
  @ApiOperation({ summary: 'List members of the organization' })
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(memberSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.members.list(tenant, query);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Leave the organization' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, [HttpStatus.CONFLICT, ErrorCode.CONFLICT])
  async leave(@Tenant() tenant: TenantContext, @Req() req: AppRequest): Promise<void> {
    await this.members.leave(tenant, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.MEMBERS_UPDATE)
  @ApiOperation({ summary: 'Change a member role or status' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateMemberSchema)
  @ApiZodResponse(memberSchema)
  @ApiErrors(
    ...COMMON_TENANT_ERRORS,
    [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
    [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
  )
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateMemberSchema)) body: UpdateMemberRequest,
    @Req() req: AppRequest,
  ) {
    return this.members.update(tenant, id, body, requestMeta(req));
  }

  @Delete(':id')
  @RequirePermissions(Permission.MEMBERS_REMOVE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member' })
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
    await this.members.remove(tenant, id, requestMeta(req));
  }
}
