import { ALL_PERMISSIONS, ErrorCode } from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';

import { createAuditMock, createPrismaMock } from '../../test-utils/prisma.mock';
import { type AuditService } from '../audit/audit.service';
import { type CrmReferencesService } from '../crm/crm-references.service';
import { type NotificationsService } from '../notifications/notifications.service';
import { LeadsService, diffLead } from './leads.service';

const ORG = '22222222-2222-4222-8222-222222222222';
const tenant = {
  organizationId: ORG,
  userId: 'u1',
  memberId: 'm1',
  roleId: 'r1',
  roleKey: 'owner',
  permissions: ALL_PERMISSIONS,
};
const meta = { ipAddress: null, userAgent: null, requestId: null };
const now = new Date('2026-11-01T10:00:00Z');

function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    organizationId: ORG,
    title: 'Big deal',
    status: 'new' as const,
    source: 'website' as const,
    value: new Prisma.Decimal('1500.50'),
    currency: 'USD',
    contactId: null,
    assigneeId: null,
    description: null,
    tags: ['a'],
    customFields: {},
    expectedCloseDate: null,
    convertedAt: null,
    lostReason: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    contact: null,
    assignee: null,
    ...overrides,
  };
}

describe('diffLead', () => {
  it('keeps only fields that actually change and classifies them', () => {
    const { data, changes } = diffLead(leadRow(), {
      title: 'Big deal', // unchanged
      status: 'qualified',
      value: 1500.5, // unchanged (Decimal compared as number)
      tags: ['a'], // unchanged
      description: 'Now with details',
      assigneeId: 'u2',
    });
    expect(data).toEqual({
      status: 'qualified',
      description: 'Now with details',
      assigneeId: 'u2',
    });
    expect(changes).toEqual({
      status: 'qualified',
      assigneeId: 'u2',
      otherFields: ['description'],
    });
  });

  it('converts expectedCloseDate to a Date and detects same-instant as unchanged', () => {
    const existing = leadRow({ expectedCloseDate: new Date('2026-12-01T00:00:00.000Z') });
    expect(diffLead(existing, { expectedCloseDate: '2026-12-01T00:00:00.000Z' }).data).toEqual({});
    const changed = diffLead(existing, { expectedCloseDate: '2026-12-24T00:00:00.000Z' });
    expect(changed.data.expectedCloseDate).toEqual(new Date('2026-12-24T00:00:00.000Z'));
    expect(changed.changes.otherFields).toEqual(['expectedCloseDate']);
  });
});

describe('LeadsService', () => {
  function build() {
    const { service: prisma, client } = createPrismaMock();
    const audit = createAuditMock();
    const refs = {
      assertActiveMember: jest.fn().mockResolvedValue(undefined),
      assertContact: jest.fn().mockResolvedValue(undefined),
      assertLead: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = { notify: jest.fn().mockResolvedValue(null) };
    const service = new LeadsService(
      prisma,
      audit as unknown as AuditService,
      refs as unknown as CrmReferencesService,
      notifications as unknown as NotificationsService,
    );
    return { service, client, audit, refs, notifications };
  }

  it('scopes every lookup by organization and answers 404 for foreign ids', async () => {
    const { service, client } = build();
    client.lead.findFirst.mockResolvedValue(null);
    await expect(service.get(tenant, 'foreign')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
    expect(client.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign', organizationId: ORG, deletedAt: null } }),
    );
  });

  it('PATCH writes the derived activities in the same transaction and notifies a new assignee', async () => {
    const { service, client, audit, notifications } = build();
    const existing = leadRow();
    client.lead.findFirst.mockResolvedValue(existing);
    client.lead.update.mockResolvedValue(
      leadRow({ status: 'contacted', assigneeId: 'u2', value: new Prisma.Decimal('2000') }),
    );
    client.user.findUnique.mockResolvedValue({ firstName: 'Owen', lastName: 'Owner' });

    const result = await service.update(
      tenant,
      'l1',
      { status: 'contacted', assigneeId: 'u2', value: 2000 },
      meta,
    );

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    const rows = client.leadActivity.createMany.mock.calls[0]![0].data as Array<{
      type: string;
      payload: unknown;
      createdAt: Date;
    }>;
    expect(rows).toEqual([
      expect.objectContaining({
        leadId: 'l1',
        actorId: 'u1',
        type: 'status_changed',
        payload: { from: 'new', to: 'contacted' },
      }),
      expect.objectContaining({ type: 'value_changed', payload: { from: 1500.5, to: 2000 } }),
      expect.objectContaining({ type: 'assigned', payload: { from: null, to: 'u2' } }),
    ]);
    // batch rows get strictly increasing timestamps so "newest first" is deterministic
    expect(rows[1]!.createdAt.getTime()).toBe(rows[0]!.createdAt.getTime() + 1);
    expect(rows[2]!.createdAt.getTime()).toBe(rows[0]!.createdAt.getTime() + 2);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.updated',
        metadata: { kind: 'update', changes: ['status', 'value', 'assigneeId'] },
      }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2', type: 'lead_assigned', link: '/leads/l1' }),
    );
    expect(result.value).toBe(2000);
  });

  it('PATCH with no effective change touches nothing', async () => {
    const { service, client, audit } = build();
    client.lead.findFirst.mockResolvedValue(leadRow());
    await service.update(tenant, 'l1', { title: 'Big deal', tags: ['a'] }, meta);
    expect(client.lead.update).not.toHaveBeenCalled();
    expect(client.leadActivity.createMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('a member without leads:assign cannot hand a lead to someone else through PATCH', async () => {
    const { service, client } = build();
    client.lead.findFirst.mockResolvedValue(leadRow());
    const member = { ...tenant, roleKey: 'member', permissions: ['leads:read', 'leads:update'] };
    await expect(service.update(member, 'l1', { assigneeId: 'u2' }, meta)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(client.lead.update).not.toHaveBeenCalled();
  });

  it('self-assignment never produces a notification', async () => {
    const { service, client, notifications } = build();
    client.lead.findFirst.mockResolvedValue(leadRow());
    client.lead.update.mockResolvedValue(leadRow({ assigneeId: 'u1' }));
    await service.assign(tenant, 'l1', { assigneeId: 'u1' }, meta);
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(client.leadActivity.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ type: 'assigned', payload: { from: null, to: 'u1' } })],
      }),
    );
  });

  it('convert refuses an already converted lead with 409 before touching the database', async () => {
    const { service, client } = build();
    client.lead.findFirst.mockResolvedValue(leadRow({ convertedAt: now }));
    await expect(
      service.convert(tenant, 'l1', { contact: { firstName: 'Ann' }, markWon: false }, meta),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('convert creates a contact, stamps convertedAt, marks won and records both activities', async () => {
    const { service, client, audit } = build();
    client.lead.findFirst.mockResolvedValue(leadRow({ assigneeId: 'u2' }));
    client.lead.updateMany.mockResolvedValue({ count: 1 });
    const contact = {
      id: 'c1',
      organizationId: ORG,
      firstName: 'Ann',
      lastName: null,
      email: null,
      phone: null,
      company: null,
      jobTitle: null,
      tags: [],
      notes: null,
      customFields: {},
      ownerId: 'u2',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    client.contact.create.mockResolvedValue(contact);
    client.lead.update.mockResolvedValue(
      leadRow({ contactId: 'c1', convertedAt: now, status: 'won', assigneeId: 'u2' }),
    );

    const result = await service.convert(
      tenant,
      'l1',
      { contact: { firstName: 'Ann' }, markWon: true },
      meta,
    );

    expect(client.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l1', organizationId: ORG, convertedAt: null } }),
    );
    expect(client.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: 'u2' }) }),
    );
    expect(client.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { contactId: 'c1', status: 'won' } }),
    );
    const activities = client.leadActivity.createMany.mock.calls[0]![0].data;
    expect(activities.map((a: { type: string }) => a.type)).toEqual([
      'converted',
      'status_changed',
    ]);
    expect(result.contact.id).toBe('c1');
    expect(result.lead.status).toBe('won');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.updated',
        metadata: expect.objectContaining({ kind: 'convert' }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'contact.created' }));
  });

  it('convert loses the race → 409 and the transaction is rolled back', async () => {
    const { service, client } = build();
    client.lead.findFirst.mockResolvedValue(leadRow());
    client.lead.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.convert(tenant, 'l1', { contact: { firstName: 'Ann' }, markWon: false }, meta),
    ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    expect(client.contact.create).not.toHaveBeenCalled();
  });

  it('note deletion by a non-author without leads:delete is forbidden', async () => {
    const { service, client } = build();
    client.lead.findFirst.mockResolvedValue(leadRow());
    client.leadNote.findFirst.mockResolvedValue({ id: 'n1', leadId: 'l1', authorId: 'someone' });
    const member = { ...tenant, permissions: ['leads:update'] };
    await expect(service.deleteNote(member, 'l1', 'n1', meta)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN,
    });
    expect(client.leadNote.delete).not.toHaveBeenCalled();
  });
});
