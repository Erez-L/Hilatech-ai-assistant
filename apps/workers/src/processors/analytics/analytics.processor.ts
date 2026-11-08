import { Injectable } from '@nestjs/common';
import { QueueName } from '@hilatech/contracts';
import { UnrecoverableError, type Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from '../../queue/job-processor';
import { NOT_IMPLEMENTED_OUTCOME } from '../stubs/not-implemented.processor';

export interface OrganizationDailyCounts {
  leads: number;
  contacts: number;
  conversations: number;
}

/** UTC day boundaries for a `YYYY-MM-DD` string. Throws on an impossible date (e.g. 2026-02-30). */
export function utcDayRange(date: string): { start: Date; end: Date } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(y, m - 1, d));
  if (start.getUTCFullYear() !== y || start.getUTCMonth() !== m - 1 || start.getUTCDate() !== d) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/**
 * `analytics` queue.
 *
 * - `daily_rollup`: counts leads, contacts and conversations created on the given UTC date, per
 *   organization (or for the single organization in the payload), and logs the summary. There is no
 *   analytics table in the schema yet, so the result is returned and logged but **not persisted**.
 * - `usage_rollup`: not implemented yet (needs the billing/usage design) → skipped, not failed.
 */
@Injectable()
export class AnalyticsProcessor implements JobProcessor<typeof QueueName.ANALYTICS> {
  readonly queue = QueueName.ANALYTICS;

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AnalyticsProcessor.name) private readonly logger: PinoLogger,
  ) {}

  async process(job: Job<JobPayload<typeof QueueName.ANALYTICS>>, context: JobContext): Promise<JobOutcome> {
    const { kind, date, organizationId } = job.data;

    if (kind !== 'daily_rollup') {
      this.logger.warn({ ...context, kind }, 'Analytics kind not implemented yet; job skipped (no work performed)');
      return { ...NOT_IMPLEMENTED_OUTCOME, kind };
    }

    let range: { start: Date; end: Date };
    try {
      range = utcDayRange(date);
    } catch (err) {
      throw new UnrecoverableError((err as Error).message);
    }

    const perOrganization = await this.collectDailyCounts(range, organizationId);
    const totals: OrganizationDailyCounts = { leads: 0, contacts: 0, conversations: 0 };
    for (const counts of perOrganization.values()) {
      totals.leads += counts.leads;
      totals.contacts += counts.contacts;
      totals.conversations += counts.conversations;
    }

    for (const [orgId, counts] of perOrganization) {
      this.logger.debug({ ...context, organizationId: orgId, date, ...counts }, 'Daily rollup (per organization)');
    }
    this.logger.info(
      { ...context, date, organizations: perOrganization.size, ...totals, persisted: false },
      'Daily rollup computed (not persisted: no analytics table exists yet)',
    );

    return {
      status: 'completed',
      kind,
      date,
      organizations: perOrganization.size,
      totals,
      persisted: false,
      note: 'No analytics rollup table exists yet; summary was logged only.',
    };
  }

  private async collectDailyCounts(range: { start: Date; end: Date }, organizationId: string | null): Promise<Map<string, OrganizationDailyCounts>> {
    const createdAt = { gte: range.start, lt: range.end };
    const orgFilter = organizationId ? { organizationId } : {};
    const db = this.prisma.client;

    const [leads, contacts, conversations] = await Promise.all([
      db.lead.groupBy({ by: ['organizationId'], where: { ...orgFilter, deletedAt: null, createdAt }, _count: { _all: true } }),
      db.contact.groupBy({ by: ['organizationId'], where: { ...orgFilter, deletedAt: null, createdAt }, _count: { _all: true } }),
      db.conversation.groupBy({ by: ['organizationId'], where: { ...orgFilter, createdAt }, _count: { _all: true } }),
    ]);

    const result = new Map<string, OrganizationDailyCounts>();
    const bucket = (orgId: string): OrganizationDailyCounts => {
      let entry = result.get(orgId);
      if (!entry) {
        entry = { leads: 0, contacts: 0, conversations: 0 };
        result.set(orgId, entry);
      }
      return entry;
    };
    for (const row of leads) bucket(row.organizationId).leads = row._count._all;
    for (const row of contacts) bucket(row.organizationId).contacts = row._count._all;
    for (const row of conversations) bucket(row.organizationId).conversations = row._count._all;
    return result;
  }
}
