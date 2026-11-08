import { Injectable } from '@nestjs/common';
import { NotificationType, QueueName } from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';
import { truncate } from '@hilatech/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import type { JobContext, JobOutcome, JobPayload, JobProcessor } from '../../queue/job-processor';

/** Key under which the job's idempotency key is stored inside `Notification.data`. */
export const NOTIFICATION_IDEMPOTENCY_FIELD = 'idempotencyKey';

/**
 * `notifications` queue: persist one in-app `Notification` row for the target user.
 *
 * Idempotent on `(userId, data.idempotencyKey)`: the job's `idempotencyKey` is stored inside the JSON
 * `data` column and checked before insert, so a re-delivered job (retry after a crash between insert
 * and ack, or a producer that enqueued twice with different job ids) does not create a second row.
 */
@Injectable()
export class NotificationsProcessor implements JobProcessor<typeof QueueName.NOTIFICATIONS> {
  readonly queue = QueueName.NOTIFICATIONS;

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(NotificationsProcessor.name) private readonly logger: PinoLogger,
  ) {}

  async process(job: Job<JobPayload<typeof QueueName.NOTIFICATIONS>>, context: JobContext): Promise<JobOutcome> {
    const { userId, organizationId, type, title, body, link, data, idempotencyKey } = job.data;

    // The queue contract types `type` loosely; the API reads rows back as `NotificationType`, so an
    // unknown type would produce rows the API cannot serialise. Treat it as a producer bug.
    const parsedType = NotificationType.safeParse(type);
    if (!parsedType.success) {
      this.logger.error({ ...context, type }, 'Unknown notification type; discarding job');
      throw new UnrecoverableError(`Unknown notification type "${type}" (expected one of ${NotificationType.options.join(', ')})`);
    }

    const existing = await this.prisma.client.notification.findFirst({
      where: { userId, data: { path: [NOTIFICATION_IDEMPOTENCY_FIELD], equals: idempotencyKey } },
      select: { id: true },
    });
    if (existing) {
      this.logger.info({ ...context, notificationId: existing.id }, 'Notification already exists for idempotency key; skipping');
      return { status: 'skipped', reason: 'duplicate', notificationId: existing.id };
    }

    const payload: Prisma.InputJsonObject = { ...(data as Prisma.InputJsonObject), [NOTIFICATION_IDEMPOTENCY_FIELD]: idempotencyKey };

    try {
      const created = await this.prisma.client.notification.create({
        data: {
          userId,
          organizationId,
          type: parsedType.data,
          title: truncate(title, 200),
          body: body ?? null,
          link: link ?? null,
          data: payload,
        },
        select: { id: true },
      });
      return { status: 'completed', notificationId: created.id, type: parsedType.data };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        // Foreign key violation: the user/organization no longer exists. Retrying cannot fix that.
        this.logger.warn({ ...context, userId, code: err.code }, 'Notification target does not exist; discarding job');
        throw new UnrecoverableError(`Notification target not found (userId=${userId}, organizationId=${organizationId ?? 'null'})`);
      }
      throw err;
    }
  }
}
