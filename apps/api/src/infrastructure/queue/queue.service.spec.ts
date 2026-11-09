import { DEFAULT_JOB_OPTIONS, QueueName } from '@hilatech/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import { type ModuleRef } from '@nestjs/core';
import { type Logger } from 'nestjs-pino';

import { createLoggerMock } from '../../test-utils/prisma.mock';
import { QueueService } from './queue.service';

describe('QueueService', () => {
  function build() {
    const queue = {
      add: jest.fn(async (_name: string, data: { idempotencyKey: string }) => ({
        id: data.idempotencyKey,
      })),
    };
    const moduleRef = {
      get: jest.fn((token: string) =>
        token === getQueueToken(QueueName.EMAIL) ? queue : undefined,
      ),
    };
    const service = new QueueService(
      moduleRef as unknown as ModuleRef,
      createLoggerMock() as unknown as Logger,
    );
    return { service, queue };
  }

  const payload = {
    organizationId: null,
    idempotencyKey: 'email-verify-abc12345',
    enqueuedAt: new Date().toISOString(),
    to: 'x@example.com',
    template: 'verify_email' as const,
    variables: { token: 't' },
  };

  it('validates the payload with JOB_SCHEMAS and uses the idempotencyKey as jobId with default options', async () => {
    const { service, queue } = build();
    const result = await service.enqueue(QueueName.EMAIL, payload);
    expect(result).toEqual({ jobId: 'email-verify-abc12345', queue: QueueName.EMAIL });
    expect(queue.add).toHaveBeenCalledWith(
      QueueName.EMAIL,
      expect.objectContaining({ to: 'x@example.com' }),
      expect.objectContaining({ ...DEFAULT_JOB_OPTIONS, jobId: 'email-verify-abc12345' }),
    );
  });

  it('rejects invalid payloads before touching the queue', async () => {
    const { service, queue } = build();
    await expect(
      service.enqueue(QueueName.EMAIL, { ...payload, to: 'not-an-email' }),
    ).rejects.toThrow(/Invalid payload for queue "email"/);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
