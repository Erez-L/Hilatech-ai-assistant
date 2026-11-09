import {
  type CreateKnowledgeBaseRequest,
  ErrorCode,
  type ListDocumentsQuery,
  type KnowledgeSearchRequest,
  type PaginationQuery,
  Permission,
  type UpdateKnowledgeBaseRequest,
  type UploadDocumentFields,
  createKnowledgeBaseSchema,
  documentChunkSchema,
  documentSchema,
  knowledgeBaseSchema,
  knowledgeSearchResultSchema,
  knowledgeSearchSchema,
  listDocumentsQuerySchema,
  paginationQuerySchema,
  updateKnowledgeBaseSchema,
  uploadDocumentFieldsSchema,
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
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { type Response } from 'express';
import { z } from 'zod';

import { Req, RequirePermissions, Tenant } from '../../common/decorators';
import { RequestTimeout } from '../../common/decorators/request-timeout.decorator';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
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
import { DocumentsService } from './documents.service';
import { type UploadedFileLike } from './file-validation';
import { KnowledgeBasesService } from './knowledge-bases.service';
import { KnowledgeSearchService } from './knowledge-search.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];
const AI_NOT_CONFIGURED: [number, ...ErrorCode[]] = [
  HttpStatus.CONFLICT,
  ErrorCode.CONFLICT,
  ErrorCode.AI_NOT_CONFIGURED,
];
const UPLOAD_ERRORS: Array<[number, ...ErrorCode[]]> = [
  [HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.PAYLOAD_TOO_LARGE],
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE],
  [HttpStatus.PAYMENT_REQUIRED, ErrorCode.ENTITLEMENT_EXCEEDED],
];

const listKnowledgeBasesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
});
type ListKnowledgeBasesQuery = z.infer<typeof listKnowledgeBasesQuerySchema>;

/** `Content-Disposition: attachment` with an ASCII fallback and the RFC 5987 UTF-8 name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@ApiTags('knowledge')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly bases: KnowledgeBasesService,
    private readonly documents: DocumentsService,
    private readonly search: KnowledgeSearchService,
  ) {}

  // ---- knowledge bases ---------------------------------------------------------------------

  @Get('bases')
  @RequirePermissions(Permission.KNOWLEDGE_READ)
  @ApiOperation({ summary: 'List knowledge bases with document and chunk counts' })
  @ApiZodQuery(listKnowledgeBasesQuerySchema)
  @ApiZodResponse(knowledgeBaseSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  listBases(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listKnowledgeBasesQuerySchema)) query: ListKnowledgeBasesQuery,
  ) {
    return this.bases.list(tenant, query);
  }

  @Post('bases')
  @RequirePermissions(Permission.KNOWLEDGE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a knowledge base; pins the embedding provider/model (defaults to the first embedding-capable provider)',
  })
  @ApiZodBody(createKnowledgeBaseSchema)
  @ApiZodResponse(knowledgeBaseSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, CONFLICT, NOT_FOUND)
  createBase(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createKnowledgeBaseSchema)) body: CreateKnowledgeBaseRequest,
    @Req() req: AppRequest,
  ) {
    return this.bases.create(tenant, body, requestMeta(req));
  }

  @Get('bases/:id')
  @RequirePermissions(Permission.KNOWLEDGE_READ)
  @ApiOperation({ summary: 'Get a knowledge base' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(knowledgeBaseSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  getBase(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.bases.get(tenant, id);
  }

  @Patch('bases/:id')
  @RequirePermissions(Permission.KNOWLEDGE_MANAGE)
  @ApiOperation({ summary: 'Rename / re-describe a knowledge base' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(updateKnowledgeBaseSchema)
  @ApiZodResponse(knowledgeBaseSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  updateBase(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(updateKnowledgeBaseSchema)) body: UpdateKnowledgeBaseRequest,
    @Req() req: AppRequest,
  ) {
    return this.bases.update(tenant, id, body, requestMeta(req));
  }

  @Delete('bases/:id')
  @RequirePermissions(Permission.KNOWLEDGE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a knowledge base with all its documents, chunks and stored files',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async removeBase(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.bases.remove(tenant, id, requestMeta(req));
  }

  // ---- documents ---------------------------------------------------------------------------

  @Get('bases/:id/documents')
  @RequirePermissions(Permission.KNOWLEDGE_READ)
  @ApiOperation({ summary: 'List documents of a knowledge base (status, error, chunk count)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodQuery(listDocumentsQuerySchema)
  @ApiZodResponse(documentSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  listDocuments(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodValidationPipe(listDocumentsQuerySchema)) query: ListDocumentsQuery,
  ) {
    return this.documents.list(tenant, id, query);
  }

  @Post('bases/:id/documents')
  @RequirePermissions(Permission.KNOWLEDGE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @RequestTimeout(120_000)
  @ApiOperation({
    summary:
      'Upload a document (multipart: file field "file", optional "title"); status starts as "uploaded" and processing is asynchronous',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string', maxLength: 255 },
      },
    },
  })
  @ApiZodResponse(documentSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, AI_NOT_CONFIGURED, ...UPLOAD_ERRORS)
  upload(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body(new ZodValidationPipe(uploadDocumentFieldsSchema)) fields: UploadDocumentFields,
    @Req() req: AppRequest,
  ) {
    return this.documents.upload(tenant, id, file, fields, requestMeta(req));
  }

  @Get('documents/:id')
  @RequirePermissions(Permission.KNOWLEDGE_READ)
  @ApiOperation({ summary: 'Get a document with its processing status and error' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(documentSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  getDocument(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.documents.get(tenant, id);
  }

  @Get('documents/:id/chunks')
  @RequirePermissions(Permission.KNOWLEDGE_READ)
  @ApiOperation({ summary: 'Extracted text chunks of a document, in order' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(documentChunkSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  listChunks(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ) {
    return this.documents.listChunks(tenant, id, query);
  }

  @Get('documents/:id/download')
  @RequirePermissions(Permission.KNOWLEDGE_READ)
  @SkipTransform()
  @ApiOperation({
    summary: 'Download the original file (authenticated, tenant-checked, always an attachment)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/octet-stream')
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async download(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.documents.download(tenant, id, requestMeta(req));
    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': contentDisposition(file.fileName),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(file.stream);
  }

  @Post('documents/:id/reprocess')
  @RequirePermissions(Permission.KNOWLEDGE_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Re-run processing (extraction, chunking, embeddings); the document goes back to "uploaded"',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(documentSchema, { status: HttpStatus.ACCEPTED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT, AI_NOT_CONFIGURED)
  reprocess(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.documents.reprocess(tenant, id, requestMeta(req));
  }

  @Delete('documents/:id')
  @RequirePermissions(Permission.KNOWLEDGE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a document, its chunks and the stored file' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(null)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async removeDocument(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.documents.remove(tenant, id, requestMeta(req));
  }

  // ---- retrieval ---------------------------------------------------------------------------

  @Post('search')
  @RequirePermissions(Permission.KNOWLEDGE_READ)
  @HttpCode(HttpStatus.OK)
  @RequestTimeout(60_000)
  @ApiOperation({
    summary:
      'Semantic search over ready documents; hits carry document title, chunk index and score for attribution',
  })
  @ApiZodBody(knowledgeSearchSchema)
  @ApiZodResponse(knowledgeSearchResultSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, AI_NOT_CONFIGURED)
  searchKnowledge(
    @Tenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(knowledgeSearchSchema)) body: KnowledgeSearchRequest,
  ) {
    return this.search.search(tenant, body);
  }
}
