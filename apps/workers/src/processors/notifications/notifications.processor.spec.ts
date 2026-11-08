import { QueueName } from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';
import { UnrecoverableError, type Job } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JobContext, JobPayload } from '../../queue/job-processor';
import { NOTIFICATION_IDEMPOTENCY_FIELD, NotificationsProcessor } from './notifications.processor';

type Payload = JobPayload<typeof QueueName.NOTIFICATIONS>;

function mockPrisma() {
  const notification = { findFirst: jest.fn(), create: jest.fn() };
  const service = { client: { notification } } as unknown as PrismaService;
  return { service, notification };
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as PinoLogger;

const payload: Payload = {
  organizationId: '3d3a7eb2-a87d-40b9-ab38-f9541e06435a',
  idempotencyKey: 'notif-lead-assigned-lead-42-user-1',
  enqueuedAt: new Date().toISOString(),
  userId: '437a1f21-554e-4d01-bd89-7518220f61f6',
  type: 'lead_assigned',
  title: 'A lead was assigned to you',
  body: 'Check it out',
  link: '/leads/42',
  data: { leadId: 'lead-42' },
};

const context: JobContext = {
  queue: QueueName.NOTIFICATIONS,
  jobId: payload.idempotencyKey,
  jobName: 'notifications',
  attempt: 1,
  maxAttempts: 5,
  organizationId: payload.organizationId,
  idempotencyKey: payload.idempotencyKey,
  requestId: undefined,
};

const asJob = (data: Payload): Job<Payload> => ({ id: data.idempotencyKey, data } as unknown as Job<Payload>);

describe('NotificationsProcessor', () => {
  it('creates a Notification row storing the idempotency key inside data', async () => {
    const { service, notification } = mockPrisma();
    notification.findFirst.mockResolvedValue(null);
    notification.create.mockResolvedValue({ id: 'n-1' });
    const processor = new NotificationsProcessor(service, logger);

    const outcome = await processor.process(asJob(payload), context);

    expect(outcome).toEqual({ status: 'completed', notificationId: 'n-1', type: 'lead_assigned' });
    expect(notification.findFirst).toHaveBeenCalledWith({
      where: { userId: payload.userId, data: { path: [NOTIFICATION_IDEMPOTENCY_FIELD], equals: payload.idempotencyKey } },
      select: { id: true },
    });
    expect(notification.create).toHaveBeenCalledWith({
      data: {
        userId: payload.userId,
        organizationId: payload.organizationId,
        type: 'lead_assigned',
        title: payload.title,
        body: payload.body,
        link: payload.link,
        data: { leadId: 'lead-42', [NOTIFICATION_IDEMPOTENCY_FIELD]: payload.idempotencyKey },
      },
      select: { id: true },
    });
  });

  it('is idempotent: skips when a row with the same (userId, idempotencyKey) exists', async () => {
    const { service, notification } = mockPrisma();
    notification.findFirst.mockResolvedValue({ id: 'existing-1' });
    const processor = new NotificationsProcessor(service, logger);

    const outcome = await processor.process(asJob(payload), context);

    expect(outcome).toEqual({ status: 'skipped', reason: 'duplicate', notificationId: 'existing-1' });
    expect(notification.create).not.toHaveBeenCalled();
  });

  it('accepts a null organizationId (user-scoped notification) and nulls optional fields', async () => {
    const { service, notification } = mockPrisma();
    notification.findFirst.mockResolvedValue(null);
    notification.create.mockResolvedValue({ id: 'n-2' });
    const processor = new NotificationsProcessor(service, logger);

    const { body: _b, link: _l, ...rest } = payload;
    await processor.process(asJob({ ...rest, organizationId: null, type: 'system', data: {} }), context);

    expect(notification.create.mock.calls[0]![0].data).toMatchObject({ organizationId: null, body: null, link: null, type: 'system' });
  });

  it('truncates titles longer than the 200-char column', async () => {
    const { service, notification } = mockPrisma();
    notification.findFirst.mockResolvedValue(null);
    notification.create.mockResolvedValue({ id: 'n-3' });
    const processor = new NotificationsProcessor(service, logger);

    await processor.process(asJob({ ...payload, title: 'x'.repeat(300) }), context);
    expect((notification.create.mock.calls[0]![0].data.title as string).length).toBe(200);
  });

  it('rejects unknown notification types with UnrecoverableError (no row written)', async () => {
    const { service, notification } = mockPrisma();
    const processor = new NotificationsProcessor(service, logger);

    await expect(processor.process(asJob({ ...payload, type: 'definitely_not_a_type' }), context)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(notification.findFirst).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it('maps a foreign-key violation (user gone) to UnrecoverableError', async () => {
    const { service, notification } = mockPrisma();
    notification.findFirst.mockResolvedValue(null);
    notification.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK violation', { code: 'P2003', clientVersion: 'test' }),
    );
    const processor = new NotificationsProcessor(service, logger);

    await expect(processor.process(asJob(payload), context)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('lets other database errors propagate so BullMQ retries them', async () => {
    const { service, notification } = mockPrisma();
    notification.findFirst.mockRejectedValue(new Error('connection reset'));
    const processor = new NotificationsProcessor(service, logger);

    await expect(processor.process(asJob(payload), context)).rejects.toThrow('connection reset');
  });
});
