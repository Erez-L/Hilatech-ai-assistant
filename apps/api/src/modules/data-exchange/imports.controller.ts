import {
  ErrorCode,
  type ImportConfig,
  type ListImportsQuery,
  type UploadImportFields,
  Permission,
  importConfigSchema,
  importJobSchema,
  importReportSchema,
  importUploadResultSchema,
  listImportsQuerySchema,
  uploadImportFieldsSchema,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { ImportsService, type UploadedFileLike } from './imports.service';

const NOT_FOUND: [number, ...ErrorCode[]] = [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND];
const CONFLICT: [number, ...ErrorCode[]] = [HttpStatus.CONFLICT, ErrorCode.CONFLICT];
const UPLOAD_ERRORS: Array<[number, ...ErrorCode[]]> = [
  [HttpStatus.PAYMENT_REQUIRED, ErrorCode.ENTITLEMENT_EXCEEDED],
  [HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.PAYLOAD_TOO_LARGE],
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE, ErrorCode.UNSUPPORTED_MEDIA_TYPE],
];

/**
 * CSV import jobs. Flow: upload (parse + caps) → validate (dry run, optional, repeatable) → execute (worker) →
 * poll `GET /imports/:id` → report. Needs `data:import` plus the create permission of the target entity.
 */
@ApiTags('data-exchange')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  @RequirePermissions(Permission.DATA_IMPORT)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @RequestTimeout(120_000)
  @ApiOperation({
    summary:
      'Upload a CSV (multipart: "file" + "entity" = contacts|leads|companies|deals). Detects encoding (UTF-8/BOM, UTF-16, Windows-1255) and delimiter, enforces size/row caps and returns headers, sample rows and a suggested column mapping',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'entity'],
      properties: {
        file: { type: 'string', format: 'binary' },
        entity: { type: 'string', enum: ['contacts', 'leads', 'companies', 'deals'] },
      },
    },
  })
  @ApiZodResponse(importUploadResultSchema, { status: HttpStatus.CREATED })
  @ApiErrors(...COMMON_TENANT_ERRORS, ...UPLOAD_ERRORS)
  upload(
    @Tenant() tenant: TenantContext,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body(new ZodValidationPipe(uploadImportFieldsSchema)) fields: UploadImportFields,
    @Req() req: AppRequest,
  ) {
    return this.imports.upload(tenant, file, fields.entity, requestMeta(req));
  }

  @Get()
  @RequirePermissions(Permission.DATA_IMPORT)
  @ApiOperation({ summary: 'List import jobs (newest first)' })
  @ApiZodQuery(listImportsQuerySchema)
  @ApiZodResponse(importJobSchema, { paginated: true })
  @ApiErrors(...COMMON_TENANT_ERRORS)
  list(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listImportsQuerySchema)) query: ListImportsQuery,
  ) {
    return this.imports.list(tenant, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.DATA_IMPORT)
  @ApiOperation({ summary: 'Import job with status, progress and result counters (poll while queued/running)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(importJobSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  get(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.imports.get(tenant, id);
  }

  @Post(':id/validate')
  @RequirePermissions(Permission.DATA_IMPORT)
  @HttpCode(HttpStatus.OK)
  @RequestTimeout(120_000)
  @ApiOperation({
    summary:
      'Dry run with a column mapping: per-row errors and duplicate detection (existing records and earlier rows of the file); nothing is written',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(importConfigSchema)
  @ApiZodResponse(importJobSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  validate(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(importConfigSchema)) body: ImportConfig,
    @Req() req: AppRequest,
  ) {
    return this.imports.validate(tenant, id, body, requestMeta(req));
  }

  @Post(':id/execute')
  @RequirePermissions(Permission.DATA_IMPORT)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Queue the import for the workers (status queued -> running -> completed|failed). duplicateStrategy: skip | update | create',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodBody(importConfigSchema)
  @ApiZodResponse(importJobSchema, { status: HttpStatus.ACCEPTED })
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT, [
    HttpStatus.PAYMENT_REQUIRED,
    ErrorCode.ENTITLEMENT_EXCEEDED,
  ])
  execute(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodValidationPipe(importConfigSchema)) body: ImportConfig,
    @Req() req: AppRequest,
  ) {
    return this.imports.execute(tenant, id, body, requestMeta(req));
  }

  @Post(':id/cancel')
  @RequirePermissions(Permission.DATA_IMPORT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an import that has not finished (a running import stops after its current batch)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(importJobSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND, CONFLICT)
  cancel(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Req() req: AppRequest,
  ) {
    return this.imports.cancel(tenant, id, requestMeta(req));
  }

  @Get(':id/report')
  @RequirePermissions(Permission.DATA_IMPORT)
  @ApiOperation({ summary: 'Result report: created/updated/skipped/failed counts and the skipped/failed rows with reasons' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiZodResponse(importReportSchema)
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  report(@Tenant() tenant: TenantContext, @Param('id', UuidPipe) id: string) {
    return this.imports.report(tenant, id);
  }

  @Get(':id/report.csv')
  @RequirePermissions(Permission.DATA_IMPORT)
  @SkipTransform()
  @ApiOperation({ summary: 'The report as a CSV download (UTF-8 with BOM)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('text/csv')
  @ApiErrors(...COMMON_TENANT_ERRORS, NOT_FOUND)
  async reportCsv(
    @Tenant() tenant: TenantContext,
    @Param('id', UuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const csv = await this.imports.reportCsv(tenant, id);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="import-${id}-report.csv"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }
}
