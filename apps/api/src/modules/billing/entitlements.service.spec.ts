import { ALL_PERMISSIONS, ErrorCode, PLAN_LIMITS } from '@hilatech/contracts';

import { AppException } from '../../common/errors/app.exception';
import { createPrismaMock } from '../../test-utils/prisma.mock';
import { EntitlementsService, isWithinLimit } from './entitlements.service';

const ORG = '22222222-2222-4222-8222-222222222222';
const tenant = {
  organizationId: ORG,
  userId: 'u',
  memberId: 'm',
  roleId: 'r',
  roleKey: 'owner',
  permissions: ALL_PERMISSIONS,
};

describe('isWithinLimit', () => {
  it('treats null limits as unlimited and compares used < limit otherwise', () => {
    expect(isWithinLimit({ metric: 'seats', used: 999, limit: null })).toBe(true);
    expect(isWithinLimit({ metric: 'seats', used: 1, limit: 2 })).toBe(true);
    expect(isWithinLimit({ metric: 'seats', used: 2, limit: 2 })).toBe(false);
  });
});

describe('EntitlementsService', () => {
  function build() {
    const { service: prisma, client } = createPrismaMock();
    return { service: new EntitlementsService(prisma), client };
  }

  it('falls back to the free plan when no subscription exists', async () => {
    const { service, client } = build();
    client.subscription.findUnique.mockResolvedValue(null);
    await expect(service.getLimits(ORG)).resolves.toEqual(PLAN_LIMITS.free);
  });

  it('uses the subscription limits snapshot (per-customer overrides)', async () => {
    const { service, client } = build();
    client.subscription.findUnique.mockResolvedValue({
      plan: 'free',
      limits: { ...PLAN_LIMITS.free, seats: 7 },
    });
    await expect(service.getLimits(ORG)).resolves.toMatchObject({ seats: 7 });
  });

  it('counts seats as active members + pending invitations and throws 402 when the plan is full', async () => {
    const { service, client } = build();
    client.subscription.findUnique.mockResolvedValue({ plan: 'free', limits: PLAN_LIMITS.free }); // 2 seats
    client.organizationMember.count.mockResolvedValue(1);
    client.invitation.count.mockResolvedValue(1);

    const error = (await service
      .assertWithinLimit(tenant, 'seats')
      .catch((e: unknown) => e)) as AppException;
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({
      code: ErrorCode.ENTITLEMENT_EXCEEDED,
      details: { metric: 'seats', used: 2, limit: 2 },
    });
    expect(error.getStatus()).toBe(402);
  });

  it('allows the invite when a seat is free', async () => {
    const { service, client } = build();
    client.subscription.findUnique.mockResolvedValue({ plan: 'free', limits: PLAN_LIMITS.free });
    client.organizationMember.count.mockResolvedValue(1);
    client.invitation.count.mockResolvedValue(0);
    await expect(service.assertWithinLimit(tenant, 'seats')).resolves.toEqual({
      metric: 'seats',
      used: 1,
      limit: 2,
    });
  });

  it('sums usage records of the current month for usage metrics (BigInt → number)', async () => {
    const { service, client } = build();
    client.subscription.findUnique.mockResolvedValue({
      plan: 'starter',
      limits: PLAN_LIMITS.starter,
    });
    client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(1_000_000) } });
    await expect(service.assertWithinLimit(tenant, 'ai_tokens')).rejects.toMatchObject({
      code: ErrorCode.ENTITLEMENT_EXCEEDED,
    });
  });

  it('derives documents and storage from the Document table (stock), not from monthly UsageRecord sums', async () => {
    const { service, client } = build();
    client.subscription.findUnique.mockResolvedValue({ plan: 'free', limits: PLAN_LIMITS.free });
    client.document.count.mockResolvedValue(10);
    client.document.aggregate.mockResolvedValue({ _sum: { sizeBytes: 150 * 1024 * 1024 } });
    await expect(service.check(tenant, 'documents')).resolves.toEqual({
      metric: 'documents',
      used: 10,
      limit: PLAN_LIMITS.free.knowledgeDocuments,
    });
    await expect(service.check(tenant, 'storage_mb')).resolves.toEqual({
      metric: 'storage_mb',
      used: 150,
      limit: PLAN_LIMITS.free.storageMb,
    });
    expect(client.usageRecord.aggregate).not.toHaveBeenCalled();
    await expect(service.assertWithinLimit(tenant, 'documents')).rejects.toMatchObject({
      code: ErrorCode.ENTITLEMENT_EXCEEDED,
    });
    await expect(service.assertWithinLimit(tenant, 'storage_mb')).rejects.toMatchObject({
      code: ErrorCode.ENTITLEMENT_EXCEEDED,
    });
  });

  it('counts executions and runs of the current month from their own tables', async () => {
    const { service, client } = build();
    client.subscription.findUnique.mockResolvedValue({ plan: 'free', limits: PLAN_LIMITS.free });
    client.agentExecution.count.mockResolvedValue(7);
    client.workflowExecution.count.mockResolvedValue(3);
    await expect(service.check(tenant, 'agent_executions')).resolves.toMatchObject({ used: 7 });
    await expect(service.check(tenant, 'automation_runs')).resolves.toMatchObject({ used: 3 });
    expect(client.agentExecution.count.mock.calls[0]?.[0].where).toMatchObject({
      organizationId: ORG,
      parentExecutionId: null,
    });
  });

  it('checks agents and automations against their stock', async () => {
    const { service, client } = build();
    client.subscription.findUnique.mockResolvedValue({ plan: 'free', limits: PLAN_LIMITS.free });
    client.agent.count.mockResolvedValue(1);
    client.workflow.count.mockResolvedValue(0);
    await expect(service.assertWithinLimit(tenant, 'agents')).rejects.toMatchObject({
      code: ErrorCode.ENTITLEMENT_EXCEEDED,
      details: { metric: 'agents', used: 1, limit: 1 },
    });
    await expect(service.assertWithinLimit(tenant, 'automations')).resolves.toMatchObject({
      used: 0,
    });
  });

  it('builds the overview with state per entitlement from real figures', async () => {
    const { service, client } = build();
    client.subscription.findUnique.mockResolvedValue({ plan: 'free', limits: PLAN_LIMITS.free });
    client.organizationMember.count.mockResolvedValue(2);
    client.invitation.count.mockResolvedValue(0);
    client.agent.count.mockResolvedValue(0);
    client.workflow.count.mockResolvedValue(0);
    client.usageRecord.aggregate.mockResolvedValue({ _sum: { quantity: BigInt(85_000) } });
    client.document.count.mockResolvedValue(3);
    client.document.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0 } });
    client.agentExecution.count.mockResolvedValue(0);
    client.workflowExecution.count.mockResolvedValue(0);
    const rows = await service.overview(ORG);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.seats).toMatchObject({ used: 2, limit: 2, state: 'exceeded', enforced: true });
    expect(byKey.ai_tokens).toMatchObject({ used: 85_000, percent: 85, state: 'warning' });
    expect(byKey.documents).toMatchObject({ used: 3, state: 'ok', basis: 'stock' });
    expect(byKey.agent_executions).toMatchObject({ limit: null, percent: null, state: 'ok' });
  });
});
