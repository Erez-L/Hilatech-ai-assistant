import { QueueName } from '@hilatech/contracts';

import { DomainEventsService } from './domain-events.service';

function make(enqueue: jest.Mock) {
  const logger = { error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  const service = new DomainEventsService({ enqueue } as never, logger as never);
  return { service, logger };
}

describe('DomainEventsService', () => {
  it('enqueues one automation.event job with org, actor and a JSON-safe payload', async () => {
    const enqueue = jest.fn().mockResolvedValue({ jobId: 'x' });
    const { service } = make(enqueue);
    await service.emit('org-1', 'lead.created', { leadId: 'l1', at: new Date('2026-01-01T00:00:00Z'), skip: undefined }, { actorUserId: 'u1', requestId: 'r1' });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [queue, payload] = enqueue.mock.calls[0]!;
    expect(queue).toBe(QueueName.AUTOMATION);
    expect(payload).toMatchObject({
      kind: 'event',
      organizationId: 'org-1',
      event: 'lead.created',
      actorUserId: 'u1',
      requestId: 'r1',
      payload: { leadId: 'l1', at: '2026-01-01T00:00:00.000Z', organizationId: 'org-1' },
    });
    expect(payload.payload).not.toHaveProperty('skip');
    expect(payload.idempotencyKey).toMatch(/^evt-lead\.created-/);
  });

  it('uses a fresh idempotency key per emission', async () => {
    const enqueue = jest.fn().mockResolvedValue({ jobId: 'x' });
    const { service } = make(enqueue);
    await service.emit('o', 'contact.created', {});
    await service.emit('o', 'contact.created', {});
    expect(enqueue.mock.calls[0]![1].idempotencyKey).not.toBe(enqueue.mock.calls[1]![1].idempotencyKey);
  });

  it('never throws when the queue fails (the business request must not fail) and logs the error', async () => {
    const enqueue = jest.fn().mockRejectedValue(new Error('redis down'));
    const { service, logger } = make(enqueue);
    await expect(service.emit('o', 'lead.created', { a: 1 })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('keeps only small fields of oversized payloads and marks them truncated', async () => {
    const enqueue = jest.fn().mockResolvedValue({ jobId: 'x' });
    const { service } = make(enqueue);
    await service.emit('o', 'lead.created', { big: 'x'.repeat(100_000) });
    expect(enqueue.mock.calls[0]![1].payload).toEqual({ truncated: true, organizationId: 'o' });
  });
});
