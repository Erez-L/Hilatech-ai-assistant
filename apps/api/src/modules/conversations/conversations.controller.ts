import {
  type AssignConversationRequest,
  type CreateConversationRequest,
  type CreateMessageRequest,
  ErrorCode,
  type ListConversationsQuery,
  type ListMessagesQuery,
  Permission,
  type UpdateConversationRequest,
  assignConversationSchema,
  conversationWithRelationsSchema,
  createConversationSchema,
  createMessageSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  messageWithAuthorSchema,
  updateConversationSchema,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import {
  Body,
  Controller,
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
import { ConversationsService } from './conversations.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];

@ApiTags('conversations')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @RequirePermissions(Permission.CONVERSATIONS_READ)
  @ApiOperation({
    summary: 'List conversations with contact, lead, assignee and last message preview',
  })
  @ApiZodQuery(listConversationsQuerySchema)
  @ApiZodResponse(conversationWithRelationsSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listConversationsQuerySchema)) query: ListConversationsQuery,
  ) {
    return this.conversations.list(tenant, query);
  }

  @Post()
  @RequirePermissions(Permission.CONVERSATIONS_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a conversation (optional initial agent message)' })
  @ApiZodBody(createConversationSchema)
  @ApiZodResponse(conversationWithRelationsSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createConversationSchema)) body: CreateConversationRequest,
    @Req() req: AppRequest,
  ) {
    return this.conversations.create(tenant, body, requestMeta(req));
  }

  @Get(':id')
  @RequirePermissions(Permission.CONVERSATIONS_READ)
  @ApiOperation({ summary: 'Get a conversation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(conversationWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.conversations.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CONVERSATIONS_UPDATE)
  @ApiOperation({ summary: 'Update subject, status or links of a conversation' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateConversationSchema)
  @ApiZodResponse(conversationWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateConversationSchema)) body: UpdateConversationRequest,
    @Req() req: AppRequest,
  ) {
    return this.conversations.update(tenant, id, body, requestMeta(req));
  }

  @Post(':id/assign')
  @RequirePermissions(Permission.CONVERSATIONS_ASSIGN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign (or unassign with null) a conversation; notifies the assignee' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(assignConversationSchema)
  @ApiZodResponse(conversationWithRelationsSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  assign(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(assignConversationSchema)) body: AssignConversationRequest,
    @Req() req: AppRequest,
  ) {
    return this.conversations.assign(tenant, id, body, requestMeta(req));
  }

  @Get(':id/messages')
  @RequirePermissions(Permission.CONVERSATIONS_READ)
  @ApiOperation({ summary: 'Messages of a conversation (oldest first by default)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodQuery(listMessagesQuerySchema)
  @ApiZodResponse(messageWithAuthorSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  listMessages(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: ListMessagesQuery,
  ) {
    return this.conversations.listMessages(tenant, id, query);
  }

  @Post(':id/messages')
  @RequirePermissions(Permission.CONVERSATIONS_UPDATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Post a message (roles agent | customer | system; archived → 409; resolved reopens)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(createMessageSchema)
  @ApiZodResponse(messageWithAuthorSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  postMessage(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(createMessageSchema)) body: CreateMessageRequest,
    @Req() req: AppRequest,
  ) {
    return this.conversations.postMessage(tenant, id, body, requestMeta(req));
  }
}
