import { planDealMove, statusForKind } from '@hilatech/contracts';

import { type Prisma } from '../generated/client';
import { type Db, DomainError } from './pipelines';

type StageKind = 'open' | 'won' | 'lost';

export interface DealActor {
  actorId: string | null;
  /** Recorded in the activity payload: who/what moved the deal. */
  by: 'human' | 'ai' | 'automation' | 'import';
  extra?: Record<string, unknown>;
}

export interface CreateDealInput {
  organizationId: string;
  title: string;
  description?: string | null;
  value?: number | null;
  currency?: string;
  pipelineId: string;
  stageId: string;
  ownerId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  expectedCloseAt?: Date | null;
  tags?: string[];
  lostReason?: string | null;
  now?: Date;
}

/**
 * Creates a deal at the bottom of its stage column, writes the stage-entry history row and the `created` activity.
 * The stage must belong to the pipeline and the organization (caller resolves ids inside the tenant).
 */
export async function createDealRow(db: Db, input: CreateDealInput, actor: DealActor) {
  const now = input.now ?? new Date();
  const stage = await db.pipelineStage.findFirst({
    where: {
      id: input.stageId,
      pipelineId: input.pipelineId,
      organizationId: input.organizationId,
    },
  });
  if (!stage) throw new DomainError('invalid_stage', 'Stage does not belong to the pipeline');
  const kind = stage.kind as StageKind;
  const position = await db.deal.count({
    where: { organizationId: input.organizationId, stageId: stage.id },
  });
  const deal = await db.deal.create({
    data: {
      organizationId: input.organizationId,
      title: input.title,
      description: input.description ?? null,
      value: input.value ?? null,
      currency: input.currency ?? 'USD',
      pipelineId: input.pipelineId,
      stageId: stage.id,
      status: statusForKind(kind),
      position,
      ownerId: input.ownerId ?? null,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      expectedCloseAt: input.expectedCloseAt ?? null,
      closedAt: kind === 'open' ? null : now,
      lostReason: kind === 'lost' ? (input.lostReason ?? null) : null,
      tags: input.tags ?? [],
      stageEnteredAt: now,
    },
  });
  await db.dealStageChange.create({
    data: {
      organizationId: input.organizationId,
      dealId: deal.id,
      pipelineId: input.pipelineId,
      fromStageId: null,
      toStageId: stage.id,
      actorId: actor.actorId,
    },
  });
  await db.dealActivity.create({
    data: {
      organizationId: input.organizationId,
      dealId: deal.id,
      actorId: actor.actorId,
      type: 'created',
      payload: {
        stageId: stage.id,
        stage: stage.name,
        by: actor.by,
        ...actor.extra,
      } as Prisma.InputJsonObject,
    },
  });
  return { deal, stage };
}

export interface MoveDealInput {
  organizationId: string;
  dealId: string;
  toStageId: string;
  /** 0-based position in the destination column; omitted = bottom. */
  position?: number | null;
  lostReason?: string | null;
  now?: Date;
}

/**
 * Moves a deal to a stage (and position) of its own pipeline inside the caller's transaction:
 * locks the affected columns, recomputes contiguous card positions (`planDealMove`), derives status / closedAt /
 * lostReason from the stage kind and records stage history + activity.
 */
export async function moveDealRow(db: Db, input: MoveDealInput, actor: DealActor) {
  const now = input.now ?? new Date();
  const deal = await db.deal.findFirst({
    where: { id: input.dealId, organizationId: input.organizationId },
    include: { stage: true },
  });
  if (!deal) throw new DomainError('not_found', 'Deal not found');
  const toStage = await db.pipelineStage.findFirst({
    where: {
      id: input.toStageId,
      pipelineId: deal.pipelineId,
      organizationId: input.organizationId,
    },
  });
  if (!toStage)
    throw new DomainError('invalid_stage', 'Stage does not belong to the deal pipeline');

  const stageChanged = deal.stageId !== toStage.id;
  if (!stageChanged && (input.position === undefined || input.position === null)) {
    return {
      deal,
      fromStage: deal.stage,
      toStage,
      stageChanged: false,
      previousStatus: deal.status,
    };
  }

  // Lock both columns (ordered) so concurrent moves serialise instead of interleaving positions.
  const stageIds = stageChanged ? [deal.stageId, toStage.id] : [toStage.id];
  const locked = await db.$queryRaw<Array<{ id: string; stageId: string }>>`
    SELECT "id", "stageId" FROM "Deal"
    WHERE "organizationId" = ${input.organizationId}::uuid AND "stageId" = ANY(${stageIds}::uuid[])
    ORDER BY "stageId", "position", "createdAt", "id"
    FOR UPDATE`;
  const column = (stageId: string) => locked.filter((r) => r.stageId === stageId).map((r) => r.id);
  const plan = planDealMove({
    dealId: deal.id,
    fromStageId: deal.stageId,
    toStageId: toStage.id,
    targetColumn: column(toStage.id),
    sourceColumn: column(deal.stageId),
    position: input.position ?? null,
  });
  if (plan.updates.length > 0) {
    const ids = plan.updates.map((u) => u.id);
    const positions = plan.updates.map((u) => u.position);
    await db.$executeRaw`
      UPDATE "Deal" AS d SET "position" = v.pos
      FROM (SELECT unnest(${ids}::uuid[]) AS id, unnest(${positions}::int[]) AS pos) v
      WHERE d."id" = v.id AND d."organizationId" = ${input.organizationId}::uuid`;
  }

  const fromKind = deal.stage.kind as StageKind;
  const toKind = toStage.kind as StageKind;
  const data: Prisma.DealUncheckedUpdateInput = {};
  if (stageChanged) {
    data.stageId = toStage.id;
    data.stageEnteredAt = now;
    data.status = statusForKind(toKind);
    if (toKind === 'open') {
      data.closedAt = null;
      data.lostReason = null;
    } else {
      data.closedAt = now;
      data.lostReason = toKind === 'lost' ? (input.lostReason ?? deal.lostReason ?? null) : null;
    }
  } else {
    data.updatedAt = now;
  }
  const updated = await db.deal.update({ where: { id: deal.id }, data });

  if (stageChanged) {
    await db.dealStageChange.create({
      data: {
        organizationId: input.organizationId,
        dealId: deal.id,
        pipelineId: deal.pipelineId,
        fromStageId: deal.stageId,
        toStageId: toStage.id,
        actorId: actor.actorId,
      },
    });
    const type =
      toKind === 'won'
        ? 'won'
        : toKind === 'lost'
          ? 'lost'
          : fromKind !== 'open'
            ? 'reopened'
            : 'stage_changed';
    await db.dealActivity.create({
      data: {
        organizationId: input.organizationId,
        dealId: deal.id,
        actorId: actor.actorId,
        type,
        payload: {
          fromStageId: deal.stageId,
          from: deal.stage.name,
          toStageId: toStage.id,
          to: toStage.name,
          by: actor.by,
          ...(toKind === 'lost' && updated.lostReason ? { lostReason: updated.lostReason } : {}),
          ...actor.extra,
        } as Prisma.InputJsonObject,
      },
    });
  }
  return {
    deal: {
      ...updated,
      position: plan.updates.find((u) => u.id === deal.id)?.position ?? updated.position,
    },
    fromStage: deal.stage,
    toStage,
    stageChanged,
    previousStatus: deal.status,
  };
}
