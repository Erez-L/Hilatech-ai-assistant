import type { DealBoard } from '@hilatech/contracts';

const iso = '2026-01-01T00:00:00.000Z';

export function makeBoard(): DealBoard {
  const stage = (id: string, order: number, kind: 'open' | 'won' | 'lost', probability: number) => ({
    id,
    organizationId: 'o',
    pipelineId: 'p',
    name: id.toUpperCase(),
    order,
    kind,
    probability,
    createdAt: iso,
    updatedAt: iso,
  });
  const deal = (id: string, stageId: string, value: number | null, currency: string, position: number) => ({
    id,
    organizationId: 'o',
    title: id,
    description: null,
    value,
    currency,
    pipelineId: 'p',
    stageId,
    status: 'open' as const,
    position,
    ownerId: null,
    contactId: null,
    companyId: null,
    expectedCloseAt: null,
    closedAt: null,
    lostReason: null,
    tags: [],
    stageEnteredAt: iso,
    createdAt: iso,
    updatedAt: iso,
    stage: { id: stageId, name: stageId.toUpperCase(), kind: 'open' as const, probability: 10, order: 0 },
    owner: null,
    contact: null,
    company: null,
  });
  const s1 = stage('s1', 0, 'open', 20);
  const s2 = stage('s2', 1, 'open', 50);
  const s3 = stage('s3', 2, 'lost', 0);
  return {
    pipeline: { id: 'p', name: 'Sales', isDefault: true, stages: [s1, s2, s3] },
    columns: [
      {
        stage: s1,
        deals: [deal('a', 's1', 1000, 'USD', 0), deal('b', 's1', 500, 'ILS', 1), deal('c', 's1', null, 'USD', 2)],
        count: 3,
        hasMore: false,
        totals: [
          { currency: 'ILS', count: 1, value: 500, weightedValue: 100 },
          { currency: 'USD', count: 1, value: 1000, weightedValue: 200 },
        ],
      },
      { stage: s2, deals: [], count: 0, hasMore: false, totals: [] },
      { stage: s3, deals: [], count: 0, hasMore: false, totals: [] },
    ],
    totals: [
      { currency: 'ILS', count: 1, value: 500, weightedValue: 100 },
      { currency: 'USD', count: 1, value: 1000, weightedValue: 200 },
    ],
  } as unknown as DealBoard;
}

