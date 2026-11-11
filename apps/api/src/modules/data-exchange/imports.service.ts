import {
  AuditAction,
  ErrorCode,
  IMPORT_FIELDS,
  IMPORT_MAX_ACTIVE_JOBS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  IMPORT_ROW_LIMITS,
  type ImportConfig,
  type ImportEntity,
  type ImportJob,
  type ImportReport,
  type ImportUploadResult,
  type ImportValidation,
  type ListImportsQuery,
  Permission,
  QueueName,
  suggestMapping,
  validateMapping,
} from '@hilatech/contracts';
import {
  type ImportJob as ImportJobRow,
  type Prisma,
  validateImportRows,
} from '@hilatech/database';
import {
  CsvError,
  UTF8_BOM,
  csvLine,
  decodeCsvBuffer,
  detectDelimiter,
  parseCsv,
} from '@hilatech/shared';
import { type StorageDriver, buildObjectKey, sha256Hex } from '@hilatech/storage';
import { type TenantContext } from '@hilatech/types';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { STORAGE_DRIVER } from '../../infrastructure/storage/storage.module';
import { AuditService } from '../audit/audit.service';
import { sanitizeFileName } from '../knowledge/file-validation';

const MB = 1024 * 1024;
const ALLOWED_EXTENSIONS = /\.(csv|txt|tsv)$/i;
const ACTIVE_STATUSES = ['queued', 'running'] as const;

/** Entity permission required to import into it (on top of `data:import`). */
const ENTITY_WRITE_PERMISSION: Record<ImportEntity, string> = {
  contacts: Permission.CONTACTS_CREATE,
  leads: Permission.LEADS_CREATE,
  companies: Permission.COMPANIES_CREATE,
  deals: Permission.DEALS_CREATE,
};

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export function toImportJob(row: ImportJobRow): ImportJob {
  const total = row.totalRows;
  const processed = Math.min(row.processedRows, total);
  return {
    id: row.id,
    organizationId: row.organizationId,
    entity: row.entity,
    status: row.status,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    encoding: row.encoding,
    delimiter: row.delimiter,
    headers: Array.isArray(row.headers) ? (row.headers as string[]) : [],
    totalRows: total,
    mapping: (row.mapping as ImportJob['mapping']) ?? null,
    duplicateStrategy: row.duplicateStrategy as ImportJob['duplicateStrategy'],
    validation: (row.validation as ImportValidation | null) ?? null,
    progress: {
      processed,
      total,
      percent:
        total === 0
          ? row.status === 'completed'
            ? 100
            : 0
          : Math.round((processed / total) * 1000) / 10,
    },
    result: {
      created: row.createdCount,
      updated: row.updatedCount,
      skipped: row.skippedCount,
      failed: row.failedCount,
    },
    error: row.error,
    createdById: row.createdById,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly config: AppConfig,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  get maxBytes(): number {
    return Math.min(IMPORT_MAX_BYTES, this.config.get('MAX_UPLOAD_MB') * MB);
  }

  // ---------------------------------------------------------------------------------------------

  async upload(
    tenant: TenantContext,
    file: UploadedFileLike | undefined,
    entity: ImportEntity,
    meta: RequestMeta,
  ): Promise<ImportUploadResult> {
    this.assertEntityPermission(tenant, entity);
    if (!file) {
      throw AppException.validation('A CSV file is required (multipart field "file")', [
        { path: 'file', message: 'Required', code: 'custom' },
      ]);
    }
    const fileName = sanitizeFileName(file.originalname);
    if (!ALLOWED_EXTENSIONS.test(fileName)) {
      throw new AppException(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        'Only .csv files can be imported',
      );
    }
    if (file.size === 0 || file.buffer.length === 0) {
      throw AppException.validation('The file is empty', [
        { path: 'file', message: 'Empty file', code: 'custom' },
      ]);
    }
    if (file.buffer.length > this.maxBytes) {
      throw new AppException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        ErrorCode.PAYLOAD_TOO_LARGE,
        `The file exceeds the ${Math.floor(this.maxBytes / MB) || 1} MB import limit`,
      );
    }
    if (file.buffer.subarray(0, 8192).includes(0) && !hasUtf16Bom(file.buffer)) {
      throw new AppException(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        'The file is not a text CSV',
      );
    }
    const { rowLimit } = await this.assertEntitled(tenant);

    const decoded = decodeCsvBuffer(file.buffer);
    let rows: string[][];
    try {
      rows = parseCsv(decoded.text, {
        maxRows: IMPORT_MAX_ROWS + 1,
        maxColumns: IMPORT_MAX_COLUMNS,
      });
    } catch (error) {
      if (error instanceof CsvError) {
        if (error.code === 'too_many_rows') {
          throw AppException.entitlementExceeded(
            `A file can hold at most ${IMPORT_MAX_ROWS} rows`,
            {
              metric: 'import_rows',
              limit: IMPORT_MAX_ROWS,
            },
          );
        }
        throw AppException.validation(`Invalid CSV: ${error.message}`, [
          { path: 'file', message: error.message, code: 'custom' },
        ]);
      }
      throw error;
    }
    const [headerRow, ...dataRows] = rows;
    if (!headerRow || headerRow.every((h) => h.trim() === '')) {
      throw AppException.validation('The file has no header row', [
        { path: 'file', message: 'Missing header row', code: 'custom' },
      ]);
    }
    if (dataRows.length === 0) {
      throw AppException.validation('The file has a header but no data rows', [
        { path: 'file', message: 'No data rows', code: 'custom' },
      ]);
    }
    if (dataRows.length > rowLimit) {
      throw AppException.entitlementExceeded(
        `Your plan allows importing up to ${rowLimit} rows per file (the file has ${dataRows.length})`,
        { metric: 'import_rows', limit: rowLimit, rows: dataRows.length },
      );
    }
    const headers = headerRow.map((h) => h.trim());
    const delimiter = detectDelimiter(decoded.text);

    const key = buildObjectKey(tenant.organizationId, 'imports', 'import.csv');
    await this.storage.put({
      key,
      body: file.buffer,
      contentType: 'text/csv',
      metadata: { organizationId: tenant.organizationId },
    });
    let row: ImportJobRow;
    try {
      row = await this.prisma.client.importJob.create({
        data: {
          organizationId: tenant.organizationId,
          entity,
          status: 'uploaded',
          fileName,
          sizeBytes: file.buffer.length,
          storageKey: key,
          checksum: sha256Hex(file.buffer),
          encoding: decoded.encoding,
          delimiter,
          headers,
          totalRows: dataRows.length,
          createdById: tenant.userId,
        },
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    await this.audit.log({
      action: AuditAction.IMPORT_UPLOADED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'import',
      targetId: row.id,
      metadata: {
        entity,
        fileName,
        rows: dataRows.length,
        sizeBytes: file.buffer.length,
        encoding: decoded.encoding,
      },
      request: meta,
    });
    return {
      ...toImportJob(row),
      sampleRows: dataRows.slice(0, 5),
      suggestedMapping: suggestMapping(entity, headers),
      fields: IMPORT_FIELDS[entity].map((f) => ({ ...f, aliases: [...f.aliases] })),
    };
  }

  async validate(
    tenant: TenantContext,
    id: string,
    config: ImportConfig,
    meta: RequestMeta,
  ): Promise<ImportJob> {
    const job = await this.require(tenant, id);
    this.assertEntityPermission(tenant, job.entity);
    if (job.status !== 'uploaded' && job.status !== 'validated') {
      throw AppException.conflict(`An import in status "${job.status}" can no longer be validated`);
    }
    this.assertMapping(job, config);
    const rows = await this.readRows(job);
    const validation = await validateImportRows(
      this.prisma.client,
      {
        organizationId: tenant.organizationId,
        actorId: tenant.userId,
        entity: job.entity,
        mapping: config.mapping,
        strategy: config.duplicateStrategy,
        importId: job.id,
      },
      rows,
    );
    const claimed = await this.prisma.client.importJob.updateMany({
      where: {
        id: job.id,
        organizationId: tenant.organizationId,
        status: { in: ['uploaded', 'validated'] },
      },
      data: {
        status: 'validated',
        mapping: config.mapping as Prisma.InputJsonObject,
        duplicateStrategy: config.duplicateStrategy,
        validation: validation as unknown as Prisma.InputJsonObject,
      },
    });
    if (claimed.count === 0)
      throw AppException.conflict('The import changed while it was being validated');
    await this.audit.log({
      action: AuditAction.IMPORT_VALIDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'import',
      targetId: job.id,
      metadata: {
        entity: job.entity,
        total: validation.total,
        valid: validation.valid,
        invalid: validation.invalid,
        duplicates: validation.duplicates,
      },
      request: meta,
    });
    return toImportJob(await this.requireRow(tenant, job.id));
  }

  async execute(
    tenant: TenantContext,
    id: string,
    config: ImportConfig,
    meta: RequestMeta,
  ): Promise<ImportJob> {
    const job = await this.require(tenant, id);
    this.assertEntityPermission(tenant, job.entity);
    if (job.status !== 'uploaded' && job.status !== 'validated') {
      throw AppException.conflict(`An import in status "${job.status}" cannot be started`);
    }
    this.assertMapping(job, config);
    const { rowLimit } = await this.assertEntitled(tenant, job.id);
    if (job.totalRows > rowLimit) {
      throw AppException.entitlementExceeded(
        `Your plan allows importing up to ${rowLimit} rows per file (the file has ${job.totalRows})`,
        { metric: 'import_rows', limit: rowLimit, rows: job.totalRows },
      );
    }
    const claimed = await this.prisma.client.importJob.updateMany({
      where: {
        id: job.id,
        organizationId: tenant.organizationId,
        status: { in: ['uploaded', 'validated'] },
      },
      data: {
        status: 'queued',
        mapping: config.mapping as Prisma.InputJsonObject,
        duplicateStrategy: config.duplicateStrategy,
        error: null,
      },
    });
    if (claimed.count === 0) throw AppException.conflict('The import was already started');
    try {
      await this.queue.enqueue(
        QueueName.IMPORTS,
        {
          organizationId: tenant.organizationId,
          importId: job.id,
          idempotencyKey: `import-${job.id}`,
          ...(meta.requestId ? { requestId: meta.requestId } : {}),
          enqueuedAt: new Date().toISOString(),
        },
        { attempts: 1 },
      );
    } catch (error) {
      await this.prisma.client.importJob.updateMany({
        where: { id: job.id, organizationId: tenant.organizationId, status: 'queued' },
        data: { status: job.status },
      });
      throw error;
    }
    await this.audit.log({
      action: AuditAction.IMPORT_STARTED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'import',
      targetId: job.id,
      metadata: {
        entity: job.entity,
        rows: job.totalRows,
        duplicateStrategy: config.duplicateStrategy,
      },
      request: meta,
    });
    return toImportJob(await this.requireRow(tenant, job.id));
  }

  async cancel(tenant: TenantContext, id: string, meta: RequestMeta): Promise<ImportJob> {
    const job = await this.require(tenant, id);
    const result = await this.prisma.client.importJob.updateMany({
      where: {
        id: job.id,
        organizationId: tenant.organizationId,
        status: { in: ['uploaded', 'validated', 'queued', 'running'] },
      },
      data: { status: 'cancelled', finishedAt: new Date() },
    });
    if (result.count === 0) {
      throw AppException.conflict(`An import in status "${job.status}" cannot be cancelled`);
    }
    await this.audit.log({
      action: AuditAction.IMPORT_CANCELLED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'import',
      targetId: job.id,
      metadata: { entity: job.entity, previousStatus: job.status },
      request: meta,
    });
    return toImportJob(await this.requireRow(tenant, job.id));
  }

  async list(tenant: TenantContext, query: ListImportsQuery): Promise<PageResult<ImportJob>> {
    const where: Prisma.ImportJobWhereInput = {
      organizationId: tenant.organizationId,
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.importJob.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...skipTake(query),
      }),
      this.prisma.client.importJob.count({ where }),
    ]);
    return page(rows.map(toImportJob), query, total);
  }

  async get(tenant: TenantContext, id: string): Promise<ImportJob> {
    return toImportJob(await this.requireRow(tenant, id));
  }

  async report(tenant: TenantContext, id: string): Promise<ImportReport> {
    const row = await this.requireRow(tenant, id);
    const rows = Array.isArray(row.report) ? (row.report as ImportReport['rows']) : [];
    const counted = row.skippedCount + row.failedCount;
    return {
      importId: row.id,
      status: row.status,
      result: {
        created: row.createdCount,
        updated: row.updatedCount,
        skipped: row.skippedCount,
        failed: row.failedCount,
      },
      rows,
      truncated: counted > rows.length,
    };
  }

  async reportCsv(tenant: TenantContext, id: string): Promise<string> {
    const report = await this.report(tenant, id);
    const lines = [csvLine(['row', 'status', 'reason'])];
    for (const r of report.rows) lines.push(csvLine([r.row, r.status, r.reason]));
    return `${UTF8_BOM}${lines.join('')}`;
  }

  // ---------------------------------------------------------------------------------------------

  private assertEntityPermission(tenant: TenantContext, entity: ImportEntity): void {
    const needed = ENTITY_WRITE_PERMISSION[entity];
    if (!tenant.permissions.includes(needed)) {
      throw AppException.forbidden(`Importing ${entity} requires the "${needed}" permission`);
    }
  }

  private assertMapping(job: ImportJobRow, config: ImportConfig): void {
    const headers = Array.isArray(job.headers) ? job.headers : [];
    const problems = validateMapping(job.entity, config.mapping, headers.length);
    if (problems.length > 0) {
      throw AppException.validation(
        'Invalid column mapping',
        problems.map((message) => ({ path: 'mapping', message, code: 'custom' })),
      );
    }
  }

  /** Subscription must be usable, the plan decides the row cap, and only a few imports may run at once. */
  private async assertEntitled(
    tenant: TenantContext,
    excludeJobId?: string,
  ): Promise<{ rowLimit: number }> {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { organizationId: tenant.organizationId },
      select: { status: true, plan: true },
    });
    if (subscription && subscription.status !== 'active' && subscription.status !== 'trialing') {
      throw AppException.entitlementExceeded('Imports need an active subscription', {
        metric: 'import',
        status: subscription.status,
      });
    }
    const plan = (subscription?.plan ?? 'free') as keyof typeof IMPORT_ROW_LIMITS;
    const active = await this.prisma.client.importJob.count({
      where: {
        organizationId: tenant.organizationId,
        status: { in: [...ACTIVE_STATUSES] },
        ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
      },
    });
    if (active >= IMPORT_MAX_ACTIVE_JOBS) {
      throw AppException.entitlementExceeded(
        `At most ${IMPORT_MAX_ACTIVE_JOBS} imports can run at the same time`,
        { metric: 'import_jobs', used: active, limit: IMPORT_MAX_ACTIVE_JOBS },
      );
    }
    return { rowLimit: IMPORT_ROW_LIMITS[plan] ?? IMPORT_ROW_LIMITS.free };
  }

  private async readRows(job: ImportJobRow): Promise<string[][]> {
    const buffer = await this.storage.get(job.storageKey);
    const decoded = decodeCsvBuffer(buffer);
    const rows = parseCsv(decoded.text, {
      delimiter: job.delimiter ?? undefined,
      maxRows: IMPORT_MAX_ROWS + 1,
      maxColumns: IMPORT_MAX_COLUMNS,
    });
    return rows.slice(1);
  }

  private async require(tenant: TenantContext, id: string): Promise<ImportJobRow> {
    return this.requireRow(tenant, id);
  }

  private async requireRow(tenant: TenantContext, id: string): Promise<ImportJobRow> {
    const row = await this.prisma.client.importJob.findFirst({
      where: { id, organizationId: tenant.organizationId },
    });
    if (!row) throw AppException.notFound('Import');
    return row;
  }
}

function hasUtf16Bom(b: Buffer): boolean {
  return b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff));
}
