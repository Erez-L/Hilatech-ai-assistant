import {
  type AcceptInvitationRequest,
  type CreateInvitationRequest,
  ErrorCode,
  type PaginationQuery,
  Permission,
  acceptInvitationSchema,
  createInvitationSchema,
  invitationPreviewSchema,
  invitationSchema,
  organizationSummarySchema,
  paginationQuerySchema,
} from '@hilatech/contracts';
import { type Principal, type TenantContext } from '@hilatech/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

import {
  AuthThrottle,
  CurrentUser,
  NoTenant,
  Public,
  Req,
  RequirePermissions,
  Tenant,
} from '../../common/decorators';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_AUTH_ERRORS,
  COMMON_TENANT_ERRORS,
} from '../../common/openapi/zod-openapi';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { type AppRequest, requestMeta } from '../../common/request';
import { InvitationsService } from './invitations.service';

const previewQuerySchema = z.object({ token: z.string().min(16).max(256) });

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get('preview')
  @Public()
  @AuthThrottle()
  @ApiOperation({ summary: 'Public preview of an invitation by token' })
  @ApiQuery({ name: 'token', required: true })
  @ApiZodResponse(invitationPreviewSchema)
  @ApiErrors(
    [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
    [HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR],
  )
  preview(
    @Query(new ZodValidationPipe(previewQuerySchema)) query: z.infer<typeof previewQuerySchema>,
  ) {
    return this.invitations.preview(query.token);
  }

  @Post('accept')
  @NoTenant()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept an invitation (the account email must match the invitee)' })
  @ApiZodBody(acceptInvitationSchema)
  @ApiZodResponse(organizationSummarySchema)
  @ApiErrors(
    ...COMMON_AUTH_ERRORS,
    [
      HttpStatus.BAD_REQUEST,
      ErrorCode.TOKEN_EXPIRED,
      ErrorCode.TOKEN_INVALID,
      ErrorCode.VALIDATION_ERROR,
    ],
    [HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN],
    [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
    [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
  )
  accept(
    @CurrentUser() principal: Principal,
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: AcceptInvitationRequest,
    @Req() req: AppRequest,
  ) {
    return this.invitations.accept(principal, body.token, requestMeta(req));
  }

  @Get()
  @ApiBearerAuth()
  @ApiSecurity('organization')
  @RequirePermissions(Permission.MEMBERS_INVITE)
  @ApiOperation({ summary: 'List invitations of the organization' })
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(invitationSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.invitations.list(tenant, query);
  }

  @Post()
  @ApiBearerAuth()
  @ApiSecurity('organization')
  @RequirePermissions(Permission.MEMBERS_INVITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a user by email (token is only delivered by email)' })
  @ApiZodBody(createInvitationSchema)
  @ApiZodResponse(invitationSchema, { status: HttpStatus.CREATED })
  @ApiErrors(
    ...COMMON_TENANT_ERRORS,
    [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
    [HttpStatus.PAYMENT_REQUIRED, ErrorCode.ENTITLEMENT_EXCEEDED],
  )
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationRequest,
    @Req() req: AppRequest,
  ) {
    return this.invitations.create(tenant, body, requestMeta(req));
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiSecurity('organization')
  @RequirePermissions(Permission.MEMBERS_INVITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(
    ...COMMON_TENANT_ERRORS,
    [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND],
    [HttpStatus.CONFLICT, ErrorCode.CONFLICT],
  )
  async revoke(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.invitations.revoke(tenant, id, requestMeta(req));
  }
}
