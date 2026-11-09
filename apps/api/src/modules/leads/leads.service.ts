import {
  type AssignLeadRequest,
  AuditAction,
  type Contact as ContactDto,
  type ConvertLeadRequest,
  type CreateLeadRequest,
  type LeadActivityWithActor,
  type LeadNoteWithAuthor,
  type LeadWithRelations,
  type ListLeadsQuery,
  type PaginationQuery,
  type UpdateLeadRequest,
} from '@hilatech/contracts';
import { type Contact, type Lead, type Prisma } from '@hilatech/database';
import { truncate } from '@hilatech/shared';
import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CrmReferencesService } from '../crm/crm-references.service';
import {
  USER_SUMMARY_SELECT,
  type UserSummaryRow,
  decimalToNumber,
  toContact,
} from '../crm/crm.mappers';
import { NotificationsService } from '../notifications/notifications.service';
import { type LeadActivityDraft, type LeadChanges, LeadRules } from './lead.rules';
import {
  LEAD_INCLUDE,
  LEAD_NOTE_INCLUDE,
  toLeadActivity,
  toLeadNote,
  toLeadWithRelations,
} from './leads.mappers';

export interface ConvertLeadResult {
  lead: LeadWithRelations;
  contact: ContactDto;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refs: CrmReferencesService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------------------------

  async list(tenant: TenantContext, query: ListLeadsQuery): Promise<PageResult<LeadWithRelations>> {
    const where: Prisma.LeadWhereInput = {
      organizationId: tenant.organizationId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.contactId ? { contactId: query.contactId } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.search ? { OR: searchClauses(query.search) } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.lead.findMany({
        where,
        include: LEAD_INCLUDE,
        orderBy: orderBy(query),
        ...skipTake(query),
      }),
      this.prisma.client.lead.count({ where }),
    ]);
    return page(rows.map(toLeadWithRelations), query, total);
  }

  async create(
    tenant: TenantContext,
    dto: CreateLeadRequest,
    meta: RequestMeta,
  ): Promise<LeadWithRelations> {
    if (dto.contactId) await this.refs.assertContact(tenant, dto.contactId, 'contactId');
    if (dto.assigneeId) {
      await this.refs.assertActiveMember(tenant, dto.assigneeId, 'assigneeId');
      LeadRules.assertCanSetAssignee(tenant, dto.assigneeId, null);
    }

    const lead = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          organizationId: tenant.organizationId,
          title: dto.title,
          status: dto.status,
          source: dto.source,
          value: dto.value ?? null,
          currency: dto.currency,
          contactId: dto.contactId ?? null,
          assigneeId: dto.assigneeId ?? null,
          description: dto.description ?? null,
          tags: dto.tags,
          customFields: dto.customFields as Prisma.InputJsonObject,
          expectedCloseDate: dto.expectedCloseDate ? new Date(dto.expectedCloseDate) : null,
        },
        include: LEAD_INCLUDE,
      });
      await tx.leadActivity.create({
        data: {
          leadId: created.id,
          actorId: tenant.userId,
          type: 'created',
          payload: {
            status: created.status,
            source: created.source,
            assigneeId: created.assigneeId,
            contactId: created.contactId,
          },
        },
      });
      return created;
    });

    await this.audit.log({
      action: AuditAction.LEAD_CREATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'lead',
      targetId: lead.id,
      metadata: { title: lead.title, status: lead.status, source: lead.source },
      request: meta,
    });
    if (lead.assigneeId) await this.notifyAssigned(tenant, lead, lead.assigneeId, meta);
    return toLeadWithRelations(lead);
  }

  async get(tenant: TenantContext, id: string): Promise<LeadWithRelations> {
    return toLeadWithRelations(await this.requireLead(tenant, id));
  }

  async update(
    tenant: TenantContext,
    id: string,
    dto: UpdateLeadRequest,
    meta: RequestMeta,
  ): Promise<LeadWithRelations> {
    const existing = await this.requireLead(tenant, id);

    if (dto.contactId !== undefined && dto.contactId !== existing.contactId) {
      await this.refs.assertContact(tenant, dto.contactId, 'contactId');
    }
    if (dto.assigneeId !== undefined && dto.assigneeId !== existing.assigneeId) {
      await this.refs.assertActiveMember(tenant, dto.assigneeId, 'assigneeId');
      LeadRules.assertCanSetAssignee(tenant, dto.assigneeId, existing.assigneeId);
    }

    const { data, changes } = diffLead(existing, dto);
    if (Object.keys(data).length === 0) return toLeadWithRelations(existing);
    const activities = LeadRules.deriveActivities(snapshot(existing), changes);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.lead.update({
        where: { id: existing.id },
        data,
        include: LEAD_INCLUDE,
      });
      await this.writeActivities(tx, row.id, tenant.userId, activities);
      return row;
    });

    await this.audit.log({
      action: AuditAction.LEAD_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'lead',
      targetId: existing.id,
      metadata: { kind: 'update', changes: Object.keys(data) },
      request: meta,
    });
    if (changes.assigneeId && changes.assigneeId !== existing.assigneeId) {
      await this.notifyAssigned(tenant, updated, changes.assigneeId, meta);
    }
    return toLeadWithRelations(updated);
  }

  async softDelete(tenant: TenantContext, id: string, meta: RequestMeta): Promise<void> {
    const result = await this.prisma.client.lead.updateMany({
      where: { id, organizationId: tenant.organizationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw AppException.notFound('Lead');
    await this.audit.log({
      action: AuditAction.LEAD_DELETED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'lead',
      targetId: id,
      request: meta,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Assignment & conversion
  // ---------------------------------------------------------------------------------------------

  async assign(
    tenant: TenantContext,
    id: string,
    dto: AssignLeadRequest,
    meta: RequestMeta,
  ): Promise<LeadWithRelations> {
    const existing = await this.requireLead(tenant, id);
    if (dto.assigneeId) await this.refs.assertActiveMember(tenant, dto.assigneeId, 'assigneeId');
    if (dto.assigneeId === existing.assigneeId) return toLeadWithRelations(existing);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.lead.update({
        where: { id: existing.id },
        data: { assigneeId: dto.assigneeId },
        include: LEAD_INCLUDE,
      });
      await this.writeActivities(tx, row.id, tenant.userId, [
        { type: 'assigned', payload: { from: existing.assigneeId, to: dto.assigneeId } },
      ]);
      return row;
    });

    await this.audit.log({
      action: AuditAction.LEAD_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'lead',
      targetId: existing.id,
      metadata: { kind: 'assign', from: existing.assigneeId, to: dto.assigneeId },
      request: meta,
    });
    if (dto.assigneeId) await this.notifyAssigned(tenant, updated, dto.assigneeId, meta);
    return toLeadWithRelations(updated);
  }

  /**
   * Links the lead to an existing contact or creates one, stamps `convertedAt` (once) and optionally
   * marks the lead won. Concurrent conversions are serialised by the conditional claim inside the
   * transaction, so the second caller gets `409 CONFLICT` and no orphan contact is created.
   */
  async convert(
    tenant: TenantContext,
    id: string,
    dto: ConvertLeadRequest,
    meta: RequestMeta,
  ): Promise<ConvertLeadResult> {
    const existing = await this.requireLead(tenant, id);
    LeadRules.assertConvertible(existing);
    if (dto.contactId) await this.refs.assertContact(tenant, dto.contactId, 'contactId');

    const now = new Date();
    const result = await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.lead.updateMany({
        where: { id: existing.id, organizationId: tenant.organizationId, convertedAt: null },
        data: { convertedAt: now },
      });
      if (claimed.count !== 1) {
        throw AppException.conflict('This lead has already been converted');
      }

      let createdContact = false;
      let contact: Contact;
      if (dto.contactId) {
        contact = await tx.contact.findFirstOrThrow({
          where: { id: dto.contactId, organizationId: tenant.organizationId, deletedAt: null },
        });
      } else {
        const input = dto.contact!;
        contact = await tx.contact.create({
          data: {
            organizationId: tenant.organizationId,
            firstName: input.firstName,
            lastName: input.lastName ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            company: input.company ?? null,
            ownerId: existing.assigneeId ?? tenant.userId,
          },
        });
        createdContact = true;
      }

      const nextStatus = dto.markWon ? 'won' : existing.status;
      const lead = await tx.lead.update({
        where: { id: existing.id },
        data: { contactId: contact.id, status: nextStatus },
        include: LEAD_INCLUDE,
      });

      const activities: LeadActivityDraft[] = [
        {
          type: 'converted',
          payload: {
            contactId: contact.id,
            createdContact,
            previousContactId: existing.contactId,
            markWon: dto.markWon,
          },
        },
      ];
      if (nextStatus !== existing.status) {
        activities.push({
          type: 'status_changed',
          payload: { from: existing.status, to: nextStatus, viaConversion: true },
        });
      }
      await this.writeActivities(tx, lead.id, tenant.userId, activities);
      return { lead, contact, createdContact };
    });

    await this.audit.log({
      action: AuditAction.LEAD_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'lead',
      targetId: existing.id,
      metadata: {
        kind: 'convert',
        contactId: result.contact.id,
        createdContact: result.createdContact,
        markWon: dto.markWon,
      },
      request: meta,
    });
    if (result.createdContact) {
      await this.audit.log({
        action: AuditAction.CONTACT_CREATED,
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        targetType: 'contact',
        targetId: result.contact.id,
        metadata: { fromLeadId: existing.id, email: result.contact.email },
        request: meta,
      });
    }
    return { lead: toLeadWithRelations(result.lead), contact: toContact(result.contact) };
  }

  // ---------------------------------------------------------------------------------------------
  // Notes & activities
  // ---------------------------------------------------------------------------------------------

  async listNotes(
    tenant: TenantContext,
    leadId: string,
    query: PaginationQuery,
  ): Promise<PageResult<LeadNoteWithAuthor>> {
    await this.requireLead(tenant, leadId);
    const where = { leadId };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.leadNote.findMany({
        where,
        include: LEAD_NOTE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.leadNote.count({ where }),
    ]);
    return page(rows.map(toLeadNote), query, total);
  }

  async addNote(
    tenant: TenantContext,
    leadId: string,
    body: string,
    meta: RequestMeta,
  ): Promise<LeadNoteWithAuthor> {
    const lead = await this.requireLead(tenant, leadId);
    const note = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.leadNote.create({
        data: { leadId: lead.id, authorId: tenant.userId, body },
        include: LEAD_NOTE_INCLUDE,
      });
      await this.writeActivities(tx, lead.id, tenant.userId, [
        { type: 'note_added', payload: { noteId: created.id, preview: truncate(body, 120) } },
      ]);
      return created;
    });
    await this.audit.log({
      action: AuditAction.LEAD_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'lead',
      targetId: lead.id,
      metadata: { kind: 'note_added', noteId: note.id },
      request: meta,
    });
    return toLeadNote(note);
  }

  async deleteNote(
    tenant: TenantContext,
    leadId: string,
    noteId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const lead = await this.requireLead(tenant, leadId);
    const note = await this.prisma.client.leadNote.findFirst({
      where: { id: noteId, leadId: lead.id },
    });
    if (!note) throw AppException.notFound('Note');
    LeadRules.assertCanDeleteNote(tenant, note);
    await this.prisma.client.leadNote.delete({ where: { id: note.id } });
    await this.audit.log({
      action: AuditAction.LEAD_UPDATED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'lead',
      targetId: lead.id,
      metadata: { kind: 'note_deleted', noteId: note.id, authorId: note.authorId },
      request: meta,
    });
  }

  async listActivities(
    tenant: TenantContext,
    leadId: string,
    query: PaginationQuery,
  ): Promise<PageResult<LeadActivityWithActor>> {
    await this.requireLead(tenant, leadId);
    const where = { leadId };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.leadActivity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.leadActivity.count({ where }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v): v is string => !!v))];
    const actors = actorIds.length
      ? await this.prisma.client.user.findMany({
          where: { id: { in: actorIds } },
          select: USER_SUMMARY_SELECT,
        })
      : [];
    const byId = new Map<string, UserSummaryRow>(actors.map((a) => [a.id, a]));
    return page(
      rows.map((r) => toLeadActivity(r, r.actorId ? byId.get(r.actorId) : null)),
      query,
      total,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private async requireLead(tenant: TenantContext, id: string) {
    const lead = await this.prisma.client.lead.findFirst({
      where: { id, organizationId: tenant.organizationId, deletedAt: null },
      include: LEAD_INCLUDE,
    });
    if (!lead) throw AppException.notFound('Lead');
    return lead;
  }

  private async writeActivities(
    tx: Prisma.TransactionClient,
    leadId: string,
    actorId: string,
    activities: LeadActivityDraft[],
  ): Promise<void> {
    if (activities.length === 0) return;
    // Rows of one batch share the transaction timestamp; spread them by a millisecond so the
    // timeline order (newest first) is deterministic and mirrors the derivation order.
    const base = Date.now();
    await tx.leadActivity.createMany({
      data: activities.map((a, index) => ({
        leadId,
        actorId,
        type: a.type,
        payload: a.payload as Prisma.InputJsonObject,
        createdAt: new Date(base + index),
      })),
    });
  }

  /** In-app (and, if the assignee opted in, email) notification. Self-assignment is silent. */
  private async notifyAssigned(
    tenant: TenantContext,
    lead: Pick<Lead, 'id' | 'title'>,
    assigneeId: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (assigneeId === tenant.userId) return;
    const actor = await this.prisma.client.user.findUnique({
      where: { id: tenant.userId },
      select: { firstName: true, lastName: true },
    });
    const actorName = actor ? `${actor.firstName} ${actor.lastName}`.trim() : 'A teammate';
    await this.notifications.notify({
      organizationId: tenant.organizationId,
      userId: assigneeId,
      type: 'lead_assigned',
      title: truncate(`Lead assigned to you: ${lead.title}`, 200),
      body: `${actorName} assigned you the lead "${lead.title}".`,
      link: `/leads/${lead.id}`,
      data: { leadId: lead.id, assignedBy: tenant.userId },
      requestId: meta.requestId,
    });
  }
}

// -----------------------------------------------------------------------------------------------
// Helpers (pure)
// -----------------------------------------------------------------------------------------------

/** Case-insensitive search over title, description and the linked contact's name. */
export function searchClauses(search: string): Prisma.LeadWhereInput[] {
  const contains = { contains: search, mode: 'insensitive' as const };
  return [
    { title: contains },
    { description: contains },
    { contact: { firstName: contains } },
    { contact: { lastName: contains } },
  ];
}

function orderBy(query: ListLeadsQuery): Prisma.LeadOrderByWithRelationInput {
  if (query.sortBy === 'value' || query.sortBy === 'expectedCloseDate') {
    return { [query.sortBy]: { sort: query.sortOrder, nulls: 'last' } };
  }
  return { [query.sortBy]: query.sortOrder };
}

function snapshot(lead: Lead) {
  return {
    status: lead.status,
    value: decimalToNumber(lead.value),
    contactId: lead.contactId,
    assigneeId: lead.assigneeId,
    convertedAt: lead.convertedAt,
    lostReason: lead.lostReason,
  };
}

/** Builds the Prisma update payload from a PATCH body, keeping only fields that actually change. */
export function diffLead(
  existing: Lead,
  dto: UpdateLeadRequest,
): { data: Prisma.LeadUncheckedUpdateInput; changes: LeadChanges } {
  const data: Prisma.LeadUncheckedUpdateInput = {};
  const changes: LeadChanges = { otherFields: [] };

  if (dto.title !== undefined && dto.title !== existing.title) {
    data.title = dto.title;
    changes.otherFields.push('title');
  }
  if (dto.status !== undefined && dto.status !== existing.status) {
    data.status = dto.status;
    changes.status = dto.status;
  }
  if (dto.source !== undefined && dto.source !== existing.source) {
    data.source = dto.source;
    changes.otherFields.push('source');
  }
  if (dto.value !== undefined && dto.value !== decimalToNumber(existing.value)) {
    data.value = dto.value;
    changes.value = dto.value;
  }
  if (dto.currency !== undefined && dto.currency !== existing.currency) {
    data.currency = dto.currency;
    changes.otherFields.push('currency');
  }
  if (dto.contactId !== undefined && dto.contactId !== existing.contactId) {
    data.contactId = dto.contactId;
    changes.contactId = dto.contactId;
  }
  if (dto.assigneeId !== undefined && dto.assigneeId !== existing.assigneeId) {
    data.assigneeId = dto.assigneeId;
    changes.assigneeId = dto.assigneeId;
  }
  if (dto.description !== undefined && dto.description !== existing.description) {
    data.description = dto.description;
    changes.otherFields.push('description');
  }
  if (dto.tags !== undefined && !sameStrings(dto.tags, existing.tags)) {
    data.tags = dto.tags;
    changes.otherFields.push('tags');
  }
  if (dto.customFields !== undefined) {
    data.customFields = dto.customFields as Prisma.InputJsonObject;
    changes.otherFields.push('customFields');
  }
  if (dto.expectedCloseDate !== undefined) {
    const next = new Date(dto.expectedCloseDate);
    if (next.getTime() !== existing.expectedCloseDate?.getTime()) {
      data.expectedCloseDate = next;
      changes.otherFields.push('expectedCloseDate');
    }
  }
  if (dto.lostReason !== undefined && dto.lostReason !== existing.lostReason) {
    data.lostReason = dto.lostReason;
    changes.lostReason = dto.lostReason;
  }
  return { data, changes };
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
