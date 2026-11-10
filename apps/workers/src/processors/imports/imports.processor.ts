import { Inject, Injectable } from '@nestjs/common';
import {
  AuditAction,
  IMPORT_BATCH_SIZE,
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  QueueName,
  type ImportMapping,
  type ImportReportRow,
  type DuplicateStrategy,
  type ImportEntity,
} from '@hilatech/contracts';
import { Prisma, appendReport, applyImportBatch } from '@hilatech/database';
import { decodeCsvBuffer, parseCsv } from '@hilatech/shared';
import type { StorageDriver } from '@hilatech/storage';
import type { Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from '../../queue/job-processor';
import { STORAGE_DRIVER } from '../../storage/storage.module';

/**
 * `imports` queue: executes one `ImportJob` (file, mapping and duplicate strategy were stored by the API).
 * Rows are applied in batches of `IMPORT_BATCH_SIZE`, each batch in one transaction (row failures are isolated with
 * savepoints and reported). After every batch the checkpoint (`processedRows`), counters and the capped report are
 * persisted, so progress is visible, a cancel stops the run at the next batch, and a re-delivered job resumes where it
 * stopped. Everything is scoped by the job's organization; ids in the file are never trusted.
 */
@Injectable()
export class ImportsProcessor implements JobProcessor<typeof QueueName.IMPORTS> {
  readonly queue = QueueName.IMPORTS;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    @InjectPinoLogger(ImportsProcessor.name) private readonly logger: PinoLogger,
  ) {}

  async process(job: Job<JobPayload<typeof QueueName.IMPORTS>>, context: JobContext): Promise<JobOutcome> {
    return this.run(job.data.organizationId, job.data.importId, context);
  }

  async run(organizationId: string, importId: string, context?: Partial<JobContext>): Promise<JobOutcome> {
    const db = this.prisma.client;
    const found = await db.importJob.findFirst({ where: { id: importId, organizationId } });
    if (!found) return { status: 'skipped', reason: 'not_found', importId };
    if (found.status !== 'queued' && found.status !== 'running') {
      return { status: 'skipped', reason: 'not_runnable', importId, importStatus: found.status };
    }
    // Claim queued -> running (a re-delivered job finds "running" and resumes from its checkpoint).
    if (found.status === 'queued') {
      const claim = await db.importJob.updateMany({
        where: { id: importId, organizationId, status: 'queued' },
        data: { status: 'running', startedAt: new Date(), error: null },
      });
      if (claim.count === 0) return { status: 'skipped', reason: 'claimed_elsewhere', importId };
    }
    const entity = found.entity as ImportEntity;
    const mapping = found.mapping as ImportMapping | null;
    const strategy = found.duplicateStrategy as DuplicateStrategy;
    if (!mapping) return this.fail(organizationId, importId, entity, 'The import has no column mapping');

    let rows: string[][];
    try {
      const buffer = await this.storage.get(found.storageKey);
      const decoded = decodeCsvBuffer(buffer);
      rows = parseCsv(decoded.text, {
        delimiter: found.delimiter ?? undefined,
        maxRows: IMPORT_MAX_ROWS + 1,
        maxColumns: IMPORT_MAX_COLUMNS,
      }).slice(1);
    } catch (err) {
      return this.fail(organizationId, importId, entity, `Could not read the file: ${(err as Error).message}`);
    }

    const ctx = {
      organizationId,
      actorId: found.createdById,
      entity,
      mapping,
      strategy,
      importId,
    };
    let report: ImportReportRow[] = Array.isArray(found.report) ? (found.report as unknown as ImportReportRow[]) : [];
    let processed = Math.min(found.processedRows, rows.length);

    try {
      while (processed < rows.length) {
        const current = await db.importJob.findFirst({
          where: { id: importId, organizationId },
          select: { status: true },
        });
        if (!current || current.status !== 'running') {
          this.logger.info({ ...context, importId, status: current?.status }, 'Import stopped (cancelled)');
          return { status: 'skipped', reason: 'cancelled', importId, processed };
        }
        const slice = rows.slice(processed, processed + IMPORT_BATCH_SIZE);
        const batch = await applyImportBatch(db, ctx, slice, processed + 1);
        report = appendReport(report, batch.problems).report;
        processed += slice.length;
        await db.importJob.updateMany({
          where: { id: importId, organizationId },
          data: {
            processedRows: processed,
            createdCount: { increment: batch.created },
            updatedCount: { increment: batch.updated },
            skippedCount: { increment: batch.skipped },
            failedCount: { increment: batch.failed },
            report: report as unknown as Prisma.InputJsonArray,
          },
        });
      }
    } catch (err) {
      this.logger.error({ ...context, err, importId }, 'Import failed');
      return this.fail(organizationId, importId, entity, (err as Error).message.slice(0, 500));
    }

    const done = await db.importJob.updateMany({
      where: { id: importId, organizationId, status: 'running' },
      data: { status: 'completed', finishedAt: new Date() },
    });
    const final = await db.importJob.findFirst({ where: { id: importId, organizationId } });
    if (done.count > 0 && final) {
      await this.audit(organizationId, final.createdById, importId, {
        entity,
        status: 'completed',
        created: final.createdCount,
        updated: final.updatedCount,
        skipped: final.skippedCount,
        failed: final.failedCount,
      });
    }
    return {
      status: 'completed',
      importId,
      entity,
      created: final?.createdCount ?? 0,
      updated: final?.updatedCount ?? 0,
      skipped: final?.skippedCount ?? 0,
      failed: final?.failedCount ?? 0,
    };
  }

  private async fail(
    organizationId: string,
    importId: string,
    entity: ImportEntity,
    message: string,
  ): Promise<JobOutcome> {
    const db = this.prisma.client;
    const updated = await db.importJob.updateMany({
      where: { id: importId, organizationId, status: 'running' },
      data: { status: 'failed', error: message, finishedAt: new Date() },
    });
    if (updated.count > 0) {
      const row = await db.importJob.findFirst({ where: { id: importId, organizationId }, select: { createdById: true } });
      await this.audit(organizationId, row?.createdById ?? null, importId, { entity, status: 'failed', error: message });
    }
    return { status: 'completed', importId, importStatus: 'failed', error: message };
  }

  private async audit(
    organizationId: string,
    actorUserId: string | null,
    importId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action: AuditAction.IMPORT_COMPLETED,
          organizationId,
          actorUserId,
          targetType: 'import',
          targetId: importId,
          metadata: metadata as Prisma.InputJsonObject,
        },
      });
    } catch (err) {
      this.logger.warn({ err, importId }, 'Could not write the import audit entry');
    }
  }
}
