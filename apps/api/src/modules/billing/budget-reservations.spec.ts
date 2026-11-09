import { InMemoryReservationStore } from './budget-reservations';

const ORG = 'org-1';

describe('InMemoryReservationStore', () => {
  it('lets concurrent requests fit only while the headroom lasts, then frees it on release', async () => {
    const store = new InMemoryReservationStore();
    const caps = { tokens: 1000, costMicroUsd: null };
    const req = { tokens: 400, costMicroUsd: null };
    await expect(store.tryReserve(ORG, 'a', req, caps)).resolves.toEqual({ allowed: true });
    await expect(store.tryReserve(ORG, 'b', req, caps)).resolves.toEqual({ allowed: true });
    await expect(store.tryReserve(ORG, 'c', req, caps)).resolves.toEqual({
      allowed: false,
      scope: 'tokens',
      reason: 'would_exceed',
    });
    expect(await store.outstanding(ORG)).toEqual({ tokens: 800, costMicroUsd: 0 });
    await store.release(ORG, 'a');
    await expect(store.tryReserve(ORG, 'c', req, caps)).resolves.toEqual({ allowed: true });
  });

  it('isolates organizations and expires abandoned reservations', async () => {
    let now = 0;
    const store = new InMemoryReservationStore(() => now, 1000);
    const caps = { tokens: 500, costMicroUsd: null };
    await store.tryReserve(ORG, 'a', { tokens: 500, costMicroUsd: null }, caps);
    await expect(
      store.tryReserve('org-2', 'x', { tokens: 500, costMicroUsd: null }, caps),
    ).resolves.toEqual({ allowed: true });
    await expect(
      store.tryReserve(ORG, 'b', { tokens: 1, costMicroUsd: null }, caps),
    ).resolves.toMatchObject({ allowed: false });
    now = 1001;
    await expect(
      store.tryReserve(ORG, 'b', { tokens: 1, costMicroUsd: null }, caps),
    ).resolves.toEqual({ allowed: true });
  });

  it('tracks cost reservations in micro-USD', async () => {
    const store = new InMemoryReservationStore();
    const caps = { tokens: null, costMicroUsd: 1_000_000 };
    await store.tryReserve(ORG, 'a', { tokens: 1, costMicroUsd: 600_000 }, caps);
    await expect(
      store.tryReserve(ORG, 'b', { tokens: 1, costMicroUsd: 500_000 }, caps),
    ).resolves.toEqual({ allowed: false, scope: 'cost', reason: 'would_exceed' });
  });
});
