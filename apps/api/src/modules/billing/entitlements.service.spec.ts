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
    await expect(service.check(tenant, 'agent_executions')).resolves.toEqual({
      metric: 'agent_executions',
      used: 1_000_000,
      limit: null,
    });
  });
});
