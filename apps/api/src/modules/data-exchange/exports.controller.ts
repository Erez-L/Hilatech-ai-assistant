import {
  type ExportCompaniesQuery,
  type ExportContactsQuery,
  type ExportDealsQuery,
  type ExportLeadsQuery,
  type ExportTasksQuery,
  Permission,
  exportCompaniesQuerySchema,
  exportContactsQuerySchema,
  exportDealsQuerySchema,
  exportLeadsQuerySchema,
  exportTasksQuerySchema,
} from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';
import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { type Response } from 'express';

import { Req, RequirePermissions, Tenant } from '../../common/decorators';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { RequestTimeout } from '../../common/decorators/request-timeout.decorator';
import { ApiErrors, ApiZodQuery, COMMON_TENANT_ERRORS } from '../../common/openapi/zod-openapi';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { type AppRequest, requestMeta } from '../../common/request';
import { type ExportStream, ExportsService } from './exports.service';

function send(res: Response, out: ExportStream): StreamableFile {
  const ascii = out.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(out.stream);
}

/**
 * CSV exports (`GET /export/<entity>`): the same filters as the list endpoints, streamed in batches, UTF-8 with BOM
 * (Hebrew opens correctly in Excel), formula-injection safe, audit-logged. Needs `data:export` plus the read
 * permission of the exported entity.
 */
@ApiTags('data-exchange')
@ApiBearerAuth()
@ApiSecurity('organization')
@Controller('export')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('contacts')
  @RequirePermissions(Permission.DATA_EXPORT, Permission.CONTACTS_READ)
  @SkipTransform()
  @RequestTimeout(300_000)
  @ApiOperation({ summary: 'Export contacts as CSV (filters of GET /contacts)' })
  @ApiZodQuery(exportContactsQuerySchema)
  @ApiProduces('text/csv')
  @ApiErrors(...COMMON_TENANT_ERRORS)
  contacts(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(exportContactsQuerySchema)) query: ExportContactsQuery,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, this.exports.contacts(tenant, query, requestMeta(req)));
  }

  @Get('leads')
  @RequirePermissions(Permission.DATA_EXPORT, Permission.LEADS_READ)
  @SkipTransform()
  @RequestTimeout(300_000)
  @ApiOperation({ summary: 'Export leads as CSV (filters of GET /leads)' })
  @ApiZodQuery(exportLeadsQuerySchema)
  @ApiProduces('text/csv')
  @ApiErrors(...COMMON_TENANT_ERRORS)
  leads(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(exportLeadsQuerySchema)) query: ExportLeadsQuery,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, this.exports.leads(tenant, query, requestMeta(req)));
  }

  @Get('companies')
  @RequirePermissions(Permission.DATA_EXPORT, Permission.COMPANIES_READ)
  @SkipTransform()
  @RequestTimeout(300_000)
  @ApiOperation({ summary: 'Export companies as CSV (filters of GET /companies)' })
  @ApiZodQuery(exportCompaniesQuerySchema)
  @ApiProduces('text/csv')
  @ApiErrors(...COMMON_TENANT_ERRORS)
  companies(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(exportCompaniesQuerySchema)) query: ExportCompaniesQuery,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, this.exports.companies(tenant, query, requestMeta(req)));
  }

  @Get('deals')
  @RequirePermissions(Permission.DATA_EXPORT, Permission.DEALS_READ)
  @SkipTransform()
  @RequestTimeout(300_000)
  @ApiOperation({ summary: 'Export deals as CSV (filters of GET /deals)' })
  @ApiZodQuery(exportDealsQuerySchema)
  @ApiProduces('text/csv')
  @ApiErrors(...COMMON_TENANT_ERRORS)
  deals(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(exportDealsQuerySchema)) query: ExportDealsQuery,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, this.exports.deals(tenant, query, requestMeta(req)));
  }

  @Get('tasks')
  @RequirePermissions(Permission.DATA_EXPORT, Permission.TASKS_READ)
  @SkipTransform()
  @RequestTimeout(300_000)
  @ApiOperation({ summary: 'Export tasks as CSV (filters of GET /tasks)' })
  @ApiZodQuery(exportTasksQuerySchema)
  @ApiProduces('text/csv')
  @ApiErrors(...COMMON_TENANT_ERRORS)
  tasks(
    @Tenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(exportTasksQuerySchema)) query: ExportTasksQuery,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return send(res, this.exports.tasks(tenant, query, requestMeta(req)));
  }
}
