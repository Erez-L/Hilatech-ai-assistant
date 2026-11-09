import {
  type CreateAssistantThreadRequest,
  ErrorCode,
  type ListAssistantMessagesQuery,
  type PaginationQuery,
  Permission,
  type SendAssistantMessageRequest,
  type UpdateAssistantThreadRequest,
  assistantMessageSchema,
  assistantThreadSchema,
  createAssistantThreadSchema,
  listAssistantMessagesQuerySchema,
  paginationQuerySchema,
  sendAssistantMessageSchema,
  updateAssistantThreadSchema,
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
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';

import { Req, RequestTimeout, RequirePermissions, Tenant } from '../../../common/decorators';
import { toErrorEnvelope } from '../../../common/filters/http-exception.filter';
import {
  ApiErrors,
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  COMMON_TENANT_ERRORS,
} from '../../../common/openapi/zod-openapi';
import { UuidPipe } from '../../../common/pipes/uuid.pipe';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { type AppRequest, requestIdOf, requestMeta } from '../../../common/request';
import { openSse, wantsEventStream } from '../../../common/sse';
import { mapEngineError } from '../core/ai-errors';
import { AssistantService } from './assistant.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const AI_ERRORS: Array<[number, ...ErrorCode[]]> = [
  [HttpStatus.PAYMENT_REQUIRED, ErrorCode.ENTITLEMENT_EXCEEDED],
  [HttpStatus.CONFLICT, ErrorCode.AI_NOT_CONFIGURED, ErrorCode.CONFLICT],
  [HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.AI_LIMIT_EXCEEDED],
  [HttpStatus.BAD_GATEWAY, ErrorCode.AI_PROVIDER_ERROR],
];

/** Upper bound for one assistant turn (the runner itself stops at 90s). */
const ASSISTANT_TURN_TIMEOUT_MS = 120_000;

const assistantTurnResultSchema = z.object({
  message: assistantMessageSchema,
  usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int() }),
});

@ApiTags('assistant')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('assistant/threads')
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly logger: Logger,
  ) {}

  @Get()
  @RequirePermissions(Permission.AI_ASSISTANT_USE)
  @ApiOperation({
    summary: "The caller's assistant threads in this organization, most recent first",
  })
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(assistantThreadSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.assistant.listThreads(tenant, query);
  }

  @Post()
  @RequirePermissions(Permission.AI_ASSISTANT_USE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Start a thread (optionally pinned to a provider configuration / model)',
  })
  @ApiZodBody(createAssistantThreadSchema)
  @ApiZodResponse(assistantThreadSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  create(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createAssistantThreadSchema)) body: CreateAssistantThreadRequest,
  ) {
    return this.assistant.createThread(tenant, body);
  }

  @Get(':id')
  @RequirePermissions(Permission.AI_ASSISTANT_USE)
  @ApiOperation({ summary: 'Get a thread' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(assistantThreadSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.assistant.getThread(tenant, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.AI_ASSISTANT_USE)
  @ApiOperation({ summary: 'Rename a thread or change its provider configuration / model' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateAssistantThreadSchema)
  @ApiZodResponse(assistantThreadSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  update(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateAssistantThreadSchema)) body: UpdateAssistantThreadRequest,
  ) {
    return this.assistant.updateThread(tenant, id, body);
  }

  @Delete(':id')
  @RequirePermissions(Permission.AI_ASSISTANT_USE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a thread and its messages' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async remove(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.assistant.deleteThread(tenant, id);
  }

  @Get(':id/messages')
  @RequirePermissions(Permission.AI_ASSISTANT_USE)
  @ApiOperation({ summary: 'Messages of a thread (user, assistant and tool rows), oldest first' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodQuery(listAssistantMessagesQuerySchema)
  @ApiZodResponse(assistantMessageSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  listMessages(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodValidationPipe(listAssistantMessagesQuerySchema))
    query: ListAssistantMessagesQuery,
  ) {
    return this.assistant.listMessages(tenant, id, query);
  }

  /**
   * JSON by default; with `Accept: text/event-stream` the answer is streamed as SSE
   * (`message_start` → `text_delta`* / `tool_call` / `tool_result` → `message_end` | `error`).
   */
  @Post(':id/messages')
  @RequirePermissions(Permission.AI_ASSISTANT_USE)
  @HttpCode(HttpStatus.OK)
  @RequestTimeout(ASSISTANT_TURN_TIMEOUT_MS)
  @ApiOperation({
    summary:
      'Send a message and get the assistant reply (JSON, or SSE with Accept: text/event-stream)',
  })
  @ApiProduces('application/json', 'text/event-stream')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(sendAssistantMessageSchema)
  @ApiZodResponse(assistantTurnResultSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, ...AI_ERRORS)
  async send(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(sendAssistantMessageSchema)) body: SendAssistantMessageRequest,
    @Req() req: AppRequest,
    @Res() res: Response,
  ): Promise<void> {
    const turn = await this.assistant.prepareTurn(tenant, id, body, requestMeta(req));
    const requestId = requestIdOf(req);

    if (!wantsEventStream(req)) {
      const result = await turn.run({ stream: false });
      res.status(HttpStatus.OK).json({ data: result });
      return;
    }

    const sse = openSse(res, requestId);
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort(new Error('Client disconnected'));
    });
    sse.send({ type: 'message_start', messageId: turn.userMessageId });
    try {
      const result = await turn.run({
        stream: true,
        onEvent: (event) => sse.send(event),
        signal: abort.signal,
      });
      sse.send({ type: 'message_end', message: result.message, usage: result.usage });
    } catch (error) {
      const { status, body: envelope } = toErrorEnvelope(mapEngineError(error), requestId);
      if (status >= 500) {
        this.logger.error(
          { err: error, requestId, threadId: id },
          'assistant stream failed',
          AssistantController.name,
        );
      }
      sse.send({ type: 'error', code: envelope.error.code, message: envelope.error.message });
    } finally {
      sse.end();
    }
  }
}
