import { DEFAULT_PIPELINE_NAME, DEFAULT_STAGES } from '@hilatech/contracts';

import { Prisma, type PrismaClient } from '../generated/client';

/** A PrismaClient or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** Domain-level failure the API / tools / workers translate to their own error type. */
export class DomainError extends Error {
  constructor(
    public readonly code: 'not_found' | 'invalid_stage' | 'invalid_reference' | 'invalid_state',
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface PipelineWithStages {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Array<{ id: string; name: string; order: number; probability: number; kind: 'open' | 'won' | 'lost' }>;
}

/** Creates the default sales pipeline (Lead → Qualified → Proposal → Negotiation → Won / Lost) for an organization. */
export async function createDefaultPipeline(db: Db, organizationId: string): Promise<PipelineWithStages> {
  const pipeline = await db.pipeline.create({
    data: {
      organizationId,
      name: DEFAULT_PIPELINE_NAME,
      isDefault: true,
      stages: {
        create: DEFAULT_STAGES.map((s, order) => ({
          organizationId,
          name: s.name,
          order,
          probability: s.probability,
          kind: s.kind,
        })),
      },
    },
    include: { stages: { orderBy: { order: 'asc' } } },
  });
  return pipeline;
}

/**
 * Returns the organization's default pipeline, creating it when the organization has none (organizations created
 * before pipelines existed are also backfilled by the migration). Safe under concurrency: a unique violation means
 * another request created it first.
 */
export async function ensureDefaultPipeline(
  db: PrismaClient,
  organizationId: string,
): Promise<PipelineWithStages> {
  const find = () =>
    db.pipeline.findFirst({
      where: { organizationId, isDefault: true },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
  const existing = await find();
  if (existing) return existing;
  const any = await db.pipeline.findFirst({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    include: { stages: { orderBy: { order: 'asc' } } },
  });
  if (any) {
    await db.pipeline.updateMany({ where: { id: any.id, organizationId }, data: { isDefault: true } });
    return { ...any, isDefault: true };
  }
  try {
    return await createDefaultPipeline(db, organizationId);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await find();
      if (raced) return raced;
    }
    throw error;
  }
}
