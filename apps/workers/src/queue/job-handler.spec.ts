import { QueueName } from '@hilatech/contracts';
import { UnrecoverableError, type Job } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import { createJobHandler } from './job-handler';
import type { JobOutcome, JobProcessor } from './job-processor';

function fakeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger & { info: jest.Mock; warn: jest.Mock; error: jest.Mock };
}

function fakeJob(data: unknown, overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    name: 'email',
    data,
    opts: { attempts: 5 },
    attemptsMade: 0,
    attemptsStarted: 1,
    ...overrides,
  } as unknown as Job;
}

const validEmailPayload = {
  organizationId: null,
  idempotencyKey: 'email-verify-0001',
  enqueuedAt: new Date().toISOString(),
  to: 'user@example.com',
  template: 'verify_email',
  variables: { token: 'abcdefghijklmnop' },
};

describe('createJobHandler', () => {
  it('rejects an invalid payload with UnrecoverableError and never calls the processor', async () => {
    const logger = fakeLogger();
    const processor: JobProcessor<typeof QueueName.EMAIL> = {
      queue: QueueName.EMAIL,
      process: jest.fn(),
    };
    const handler = createJobHandler(QueueName.EMAIL, processor, logger);

    const job = fakeJob({ ...validEmailPayload, to: 'not-an-email', idempotencyKey: 'short' });
    await expect(handler(job)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(handler(job)).rejects.toThrow(/Invalid payload for queue "email"/);

    expect(processor.process).not.toHaveBeenCalled();
    const [fields, message] = logger.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toMatch(/Invalid job payload/);
    expect(fields.queue).toBe('email');
    expect(fields.jobId).toBe('job-1');
    expect(Array.isArray(fields.issues)).toBe(true);
    const issuePaths = (fields.issues as Array<{ path: string[] }>).map((i) => i.path.join('.'));
    expect(issuePaths).toEqual(expect.arrayContaining(['to', 'idempotencyKey']));
  });

  it('rejects a payload with the wrong shape (missing required base fields)', async () => {
    const logger = fakeLogger();
    const processor: JobProcessor<typeof QueueName.NOTIFICATIONS> = {
      queue: QueueName.NOTIFICATIONS,
      process: jest.fn(),
    };
    const handler = createJobHandler(QueueName.NOTIFICATIONS, processor, logger);
    await expect(handler(fakeJob({ hello: 'world' }))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('runs the processor with the parsed payload (defaults applied) and logs start/completion with context', async () => {
    const logger = fakeLogger();
    const outcome: JobOutcome = { status: 'completed', notificationId: 'n-1' };
    const processor: JobProcessor<typeof QueueName.NOTIFICATIONS> = {
      queue: QueueName.NOTIFICATIONS,
      process: jest.fn().mockResolvedValue(outcome),
    };
    const handler = createJobHandler(QueueName.NOTIFICATIONS, processor, logger);

    const payload = {
      organizationId: '3d3a7eb2-a87d-40b9-ab38-f9541e06435a',
      idempotencyKey: 'notif-lead-assigned-42',
      requestId: 'req-9',
      enqueuedAt: new Date().toISOString(),
      userId: '437a1f21-554e-4d01-bd89-7518220f61f6',
      type: 'lead_assigned',
      title: 'Lead assigned',
      // `data` omitted on purpose: the schema default ({}) must be applied before the processor runs
    };
    const job = fakeJob(payload, { id: 'job-2', attemptsStarted: 2 });

    await expect(handler(job)).resolves.toEqual(outcome);

    const [passedJob, context] = (processor.process as jest.Mock).mock.calls[0] as [
      Job,
      Record<string, unknown>,
    ];
    expect(passedJob.data.data).toEqual({});
    expect(context).toMatchObject({
      queue: 'notifications',
      jobId: 'job-2',
      attempt: 2,
      maxAttempts: 5,
      organizationId: payload.organizationId,
      idempotencyKey: payload.idempotencyKey,
      requestId: 'req-9',
    });

    const messages = logger.info.mock.calls.map((c) => c[1]);
    expect(messages).toEqual(['Job started', 'Job completed']);
    const completed = logger.info.mock.calls[1]![0] as Record<string, unknown>;
    expect(typeof completed.durationMs).toBe('number');
    expect(completed.outcome).toBe('completed');
  });

  it('logs skipped outcomes at warn level', async () => {
    const logger = fakeLogger();
    const processor: JobProcessor<typeof QueueName.EMAIL> = {
      queue: QueueName.EMAIL,
      process: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'not_implemented' }),
    };
    const handler = createJobHandler(QueueName.EMAIL, processor, logger);
    await handler(fakeJob(validEmailPayload));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'skipped', reason: 'not_implemented' }),
      'Job skipped',
    );
  });

  it('re-throws processor errors and records whether a retry will happen', async () => {
    const logger = fakeLogger();
    const boom = new Error('smtp down');
    const processor: JobProcessor<typeof QueueName.EMAIL> = {
      queue: QueueName.EMAIL,
      process: jest.fn().mockRejectedValue(boom),
    };
    const handler = createJobHandler(QueueName.EMAIL, processor, logger);

    await expect(handler(fakeJob(validEmailPayload, { attemptsStarted: 1 }))).rejects.toBe(boom);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ willRetry: true, unrecoverable: false, err: boom }),
      'Job failed',
    );

    logger.error.mockClear();
    await expect(handler(fakeJob(validEmailPayload, { attemptsStarted: 5 }))).rejects.toBe(boom);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ willRetry: false }),
      'Job failed',
    );

    logger.error.mockClear();
    (processor.process as jest.Mock).mockRejectedValue(new UnrecoverableError('bad'));
    await expect(handler(fakeJob(validEmailPayload))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ willRetry: false, unrecoverable: true }),
      'Job failed',
    );
  });
});
