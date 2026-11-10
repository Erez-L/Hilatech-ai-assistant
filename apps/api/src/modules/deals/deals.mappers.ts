import {
  type DealActivityWithActor,
  DealActivityType,
  type DealNoteWithAuthor,
  type DealWithRelations,
  type Pipeline as PipelineDto,
  type PipelineStage as PipelineStageDto,
} from '@hilatech/contracts';
import {
  type Deal,
  type DealActivity,
  type DealNote,
  type Pipeline,
  type PipelineStage,
  type Prisma,
} from '@hilatech/database';

import {
  CONTACT_SUMMARY_SELECT,
  type ContactSummaryRow,
  USER_SUMMARY_SELECT,
  type UserSummaryRow,
  decimalToNumber,
  isoOrNull,
  jsonObject,
  toContactSummary,
  toUserSummary,
} from '../crm/crm.mappers';

export const DEAL_INCLUDE = {
  stage: { select: { id: true, name: true, kind: true, probability: true, order: true } },
  owner: { select: USER_SUMMARY_SELECT },
  contact: { select: CONTACT_SUMMARY_SELECT },
  company: { select: { id: true, name: true, domain: true } },
} as const satisfies Prisma.DealInclude;

export type DealRow = Deal & {
  stage: Pick<PipelineStage, 'id' | 'name' | 'kind' | 'probability' | 'order'>;
  owner: UserSummaryRow | null;
  contact: ContactSummaryRow | null;
  company: { id: string; name: string; domain: string | null } | null;
};

export function toDealWithRelations(row: DealRow): DealWithRelations {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    description: row.description,
    value: decimalToNumber(row.value),
    currency: row.currency,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    status: row.status,
    position: row.position,
    ownerId: row.ownerId,
    contactId: row.contactId,
    companyId: row.companyId,
    expectedCloseAt: isoOrNull(row.expectedCloseAt),
    closedAt: isoOrNull(row.closedAt),
    lostReason: row.lostReason,
    tags: row.tags,
    stageEnteredAt: row.stageEnteredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    stage: {
      id: row.stage.id,
      name: row.stage.name,
      kind: row.stage.kind,
      probability: row.stage.probability,
      order: row.stage.order,
    },
    owner: toUserSummary(row.owner),
    contact: toContactSummary(row.contact),
    company: row.company,
  };
}

export function toStage(row: PipelineStage): PipelineStageDto {
  return {
    id: row.id,
    pipelineId: row.pipelineId,
    name: row.name,
    order: row.order,
    probability: row.probability,
    kind: row.kind,
  };
}

export function toPipeline(
  row: Pipeline & { stages: PipelineStage[] },
  dealCount: number,
): PipelineDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    isDefault: row.isDefault,
    stages: [...row.stages].sort((a, b) => a.order - b.order).map(toStage),
    dealCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const DEAL_NOTE_INCLUDE = {
  author: { select: USER_SUMMARY_SELECT },
} as const satisfies Prisma.DealNoteInclude;

export function toDealNote(row: DealNote & { author: UserSummaryRow | null }): DealNoteWithAuthor {
  return {
    id: row.id,
    dealId: row.dealId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: toUserSummary(row.author),
  };
}

export function toDealActivity(
  row: DealActivity,
  actor: UserSummaryRow | null | undefined,
): DealActivityWithActor {
  const type = DealActivityType.safeParse(row.type);
  return {
    id: row.id,
    dealId: row.dealId,
    actorId: row.actorId,
    type: type.success ? type.data : 'updated',
    payload: jsonObject(row.payload),
    createdAt: row.createdAt.toISOString(),
    actor: toUserSummary(actor),
  };
}
