import {
  AuditAction,
  type Contact,
  ErrorCode,
  type LeadActivityWithActor,
  type LeadWithRelations,
  type Role,
} from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  expectNoSensitiveLeak,
  register,
  resetDatabase,
} from './setup/test-app';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Leads', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let outsider: Actor;
  let orgId: string;
  let contact: Contact;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    outsider = await register(ctx, { firstName: 'Out', lastName: 'Sider' });
    orgId = (await createOrganization(ctx, owner, 'Leads Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
    contact = (
      await as(ctx, owner, orgId)
        .post('/api/v1/contacts')
        .send({ firstName: 'Dana', lastName: 'Deal', email: 'dana@example.com' })
    ).body.data;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function activitiesOf(leadId: string): Promise<LeadActivityWithActor[]> {
    const res = await as(ctx, owner, orgId).get(`/api/v1/leads/${leadId}/activities?pageSize=50`);
    expect(res.status).toBe(200);
    return res.body.data;
  }

  let lead: LeadWithRelations;

  describe('CRUD', () => {
    it('creates a lead with defaults, embeds the contact summary and records a "created" activity', async () => {
      const res = await as(ctx, member, orgId)
        .post('/api/v1/leads')
        .send({ title: 'Website redesign', contactId: contact.id, value: 1200.5, currency: 'eur' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        organizationId: orgId,
        title: 'Website redesign',
        status: 'new',
        source: 'other',
        value: 1200.5,
        currency: 'EUR',
        contactId: contact.id,
        contact: { id: contact.id, firstName: 'Dana', email: 'dana@example.com' },
        assignee: null,
        convertedAt: null,
      });
      expectNoSensitiveLeak(res.body);
      lead = res.body.data;

      const activities = await activitiesOf(lead.id);
      expect(activities).toHaveLength(1);
      expect(activities[0]).toMatchObject({
        type: 'created',
        actorId: member.user.id,
        actor: { id: member.user.id, firstName: 'Mia' },
      });
      const audit = await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.LEAD_CREATED, targetId: lead.id },
      });
      expect(audit).toBe(1);
    });

    it('rejects references outside the organization as validation errors', async () => {
      const badContact = await as(ctx, owner, orgId)
        .post('/api/v1/leads')
        .send({ title: 'x', contactId: UNKNOWN_ID });
      expect(badContact.status).toBe(400);
      expect(badContact.body.error.details[0].path).toBe('contactId');
      const badAssignee = await as(ctx, owner, orgId)
        .post('/api/v1/leads')
        .send({ title: 'x', assigneeId: outsider.user.id });
      expect(badAssignee.status).toBe(400);
      expect(badAssignee.body.error.details[0].path).toBe('assigneeId');
    });

    it('lists with filters and search over title / description / contact name', async () => {
      const other = await as(ctx, owner, orgId)
        .post('/api/v1/leads')
        .send({
          title: 'Mobile app',
          status: 'qualified',
          source: 'referral',
          tags: ['hot'],
          description: 'React Native build',
          value: 50000,
        });
      expect(other.status).toBe(201);

      const all = await as(ctx, member, orgId).get('/api/v1/leads');
      expect(all.body.meta.total).toBe(2);
      const ids = (q: string) =>
        as(ctx, member, orgId)
          .get(`/api/v1/leads?${q}`)
          .then((r) => r.body.data.map((l: LeadWithRelations) => l.id));
      expect(await ids('status=qualified')).toEqual([other.body.data.id]);
      expect(await ids('source=referral')).toEqual([other.body.data.id]);
      expect(await ids('tag=hot')).toEqual([other.body.data.id]);
      expect(await ids(`contactId=${contact.id}`)).toEqual([lead.id]);
      expect(await ids('search=REDESIGN')).toEqual([lead.id]);
      expect(await ids('search=native')).toEqual([other.body.data.id]);
      expect(await ids('search=dana')).toEqual([lead.id]);
      expect(await ids('sortBy=value&sortOrder=asc')).toEqual([lead.id, other.body.data.id]);
    });

    it('PATCH records typed activities (status with lostReason, value, assignee) and a plain update', async () => {
      const statusRes = await as(ctx, member, orgId)
        .patch(`/api/v1/leads/${lead.id}`)
        .send({ status: 'lost', lostReason: 'Budget cut', value: 900 });
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.data).toMatchObject({
        status: 'lost',
        lostReason: 'Budget cut',
        value: 900,
      });

      const plain = await as(ctx, member, orgId)
        .patch(`/api/v1/leads/${lead.id}`)
        .send({ title: 'Website redesign (v2)', tags: ['design'] });
      expect(plain.status).toBe(200);

      const noop = await as(ctx, member, orgId)
        .patch(`/api/v1/leads/${lead.id}`)
        .send({ title: 'Website redesign (v2)' });
      expect(noop.status).toBe(200);

      const activities = await activitiesOf(lead.id);
      // newest first; within one PATCH the derivation order is status → value, so value is newer
      expect(activities.map((a) => a.type)).toEqual([
        'updated',
        'value_changed',
        'status_changed',
        'created',
      ]);
      expect(activities[0]!.payload).toEqual({ fields: ['title', 'tags'] });
      expect(activities[1]!.payload).toEqual({ from: 1200.5, to: 900 });
      expect(activities[2]!.payload).toEqual({
        from: 'new',
        to: 'lost',
        lostReason: 'Budget cut',
      });
      const audits = await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.LEAD_UPDATED, targetId: lead.id },
      });
      expect(audits).toBe(2); // the no-op PATCH is not audited
    });

    it('a member cannot assign through PATCH but can take the lead themselves', async () => {
      const denied = await as(ctx, member, orgId)
        .patch(`/api/v1/leads/${lead.id}`)
        .send({ assigneeId: owner.user.id });
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe(ErrorCode.FORBIDDEN);

      const self = await as(ctx, member, orgId)
        .patch(`/api/v1/leads/${lead.id}`)
        .send({ assigneeId: member.user.id });
      expect(self.status).toBe(200);
      expect(self.body.data.assignee).toMatchObject({ id: member.user.id, firstName: 'Mia' });
      const [latest] = await activitiesOf(lead.id);
      expect(latest).toMatchObject({
        type: 'assigned',
        payload: { from: null, to: member.user.id },
      });
      // self-assignment produces no notification
      expect(
        await ctx.prisma.client.notification.count({ where: { userId: member.user.id } }),
      ).toBe(0);
    });
  });

  describe('assignment', () => {
    it('POST /leads/:id/assign requires leads:assign, validates the member, records the activity and notifies', async () => {
      const denied = await as(ctx, member, orgId)
        .post(`/api/v1/leads/${lead.id}/assign`)
        .send({ assigneeId: owner.user.id });
      expect(denied.status).toBe(403);

      const bad = await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${lead.id}/assign`)
        .send({ assigneeId: outsider.user.id });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details[0].path).toBe('assigneeId');

      const res = await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${lead.id}/assign`)
        .send({ assigneeId: member.user.id });
      expect(res.status).toBe(200);
      expect(res.body.data.assigneeId).toBe(member.user.id);
      // already assigned to Mia by the PATCH above → no new activity, no notification
      const activities = await activitiesOf(lead.id);
      expect(activities.filter((a) => a.type === 'assigned')).toHaveLength(1);

      // reassign to the owner from the member's account is forbidden; from the owner → notifies nobody (self)
      const toOwner = await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${lead.id}/assign`)
        .send({ assigneeId: owner.user.id });
      expect(toOwner.status).toBe(200);
      expect(await ctx.prisma.client.notification.count({ where: { userId: owner.user.id } })).toBe(
        0,
      );

      // and back to the member → in-app notification for Mia
      const back = await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${lead.id}/assign`)
        .send({ assigneeId: member.user.id });
      expect(back.status).toBe(200);
      const notif = await ctx.prisma.client.notification.findFirst({
        where: { userId: member.user.id, type: 'lead_assigned' },
      });
      expect(notif).toMatchObject({
        organizationId: orgId,
        link: `/leads/${lead.id}`,
        data: { leadId: lead.id, assignedBy: owner.user.id },
        readAt: null,
      });
      expect(notif?.title).toContain('Website redesign (v2)');
      const audit = await ctx.prisma.client.auditLog.findFirst({
        where: { organizationId: orgId, action: AuditAction.LEAD_UPDATED, targetId: lead.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.metadata).toMatchObject({ kind: 'assign', to: member.user.id });

      const unassign = await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${lead.id}/assign`)
        .send({ assigneeId: null });
      expect(unassign.status).toBe(200);
      expect(unassign.body.data.assignee).toBeNull();
    });
  });

  describe('notes', () => {
    let noteId: string;
    let ownerNoteId: string;

    it('adds notes (activity note_added) and lists them newest first with the author', async () => {
      const res = await as(ctx, member, orgId)
        .post(`/api/v1/leads/${lead.id}/notes`)
        .send({ body: 'Called, left voicemail' });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        leadId: lead.id,
        authorId: member.user.id,
        body: 'Called, left voicemail',
        author: { id: member.user.id, email: member.email },
      });
      noteId = res.body.data.id;
      const second = await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${lead.id}/notes`)
        .send({ body: 'Owner note' });
      ownerNoteId = second.body.data.id;

      const list = await as(ctx, member, orgId).get(`/api/v1/leads/${lead.id}/notes`);
      expect(list.status).toBe(200);
      expect(list.body.meta.total).toBe(2);
      expect(list.body.data[0].id).toBe(ownerNoteId);
      const [latest] = await activitiesOf(lead.id);
      expect(latest).toMatchObject({ type: 'note_added', payload: { noteId: ownerNoteId } });
      const empty = await as(ctx, member, orgId)
        .post(`/api/v1/leads/${lead.id}/notes`)
        .send({ body: '   ' });
      expect(empty.status).toBe(400);
    });

    it('only the author or a holder of leads:delete can delete a note', async () => {
      const denied = await as(ctx, member, orgId).delete(
        `/api/v1/leads/${lead.id}/notes/${ownerNoteId}`,
      );
      expect(denied.status).toBe(403);
      const own = await as(ctx, member, orgId).delete(`/api/v1/leads/${lead.id}/notes/${noteId}`);
      expect(own.status).toBe(204);
      const byOwner = await as(ctx, owner, orgId).delete(
        `/api/v1/leads/${lead.id}/notes/${ownerNoteId}`,
      );
      expect(byOwner.status).toBe(204);
      expect(
        (await as(ctx, owner, orgId).delete(`/api/v1/leads/${lead.id}/notes/${noteId}`)).status,
      ).toBe(404);
      expect(
        (await as(ctx, owner, orgId).get(`/api/v1/leads/${lead.id}/notes`)).body.meta.total,
      ).toBe(0);
    });
  });

  describe('conversion', () => {
    it('requires exactly one of contactId / contact', async () => {
      const none = await as(ctx, owner, orgId).post(`/api/v1/leads/${lead.id}/convert`).send({});
      expect(none.status).toBe(400);
      const both = await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${lead.id}/convert`)
        .send({ contactId: contact.id, contact: { firstName: 'X' } });
      expect(both.status).toBe(400);
      const foreign = await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${lead.id}/convert`)
        .send({ contactId: UNKNOWN_ID });
      expect(foreign.status).toBe(400);
      expect(foreign.body.error.details[0].path).toBe('contactId');
    });

    it('creates a contact, links it, stamps convertedAt, marks won and is audited; a second conversion → 409', async () => {
      const fresh = (
        await as(ctx, owner, orgId)
          .post('/api/v1/leads')
          .send({ title: 'Convert me', assigneeId: member.user.id, value: 300 })
      ).body.data as LeadWithRelations;

      const res = await as(ctx, member, orgId)
        .post(`/api/v1/leads/${fresh.id}/convert`)
        .send({
          contact: { firstName: 'New', lastName: 'Customer', email: 'NEW@x.io' },
          markWon: true,
        });
      expect(res.status).toBe(200);
      expect(res.body.data.lead).toMatchObject({
        id: fresh.id,
        status: 'won',
        contactId: res.body.data.contact.id,
        contact: { firstName: 'New', email: 'new@x.io' },
      });
      expect(res.body.data.lead.convertedAt).toEqual(expect.any(String));
      expect(res.body.data.contact).toMatchObject({
        organizationId: orgId,
        firstName: 'New',
        email: 'new@x.io',
        ownerId: member.user.id, // the lead's assignee owns the new contact
      });

      const activities = await activitiesOf(fresh.id);
      expect(activities.map((a) => a.type)).toEqual(['status_changed', 'converted', 'created']);
      expect(activities[1]!.payload).toMatchObject({ createdContact: true, markWon: true });

      const again = await as(ctx, member, orgId)
        .post(`/api/v1/leads/${fresh.id}/convert`)
        .send({ contactId: contact.id });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe(ErrorCode.CONFLICT);

      const audits = await ctx.prisma.client.auditLog.findMany({
        where: { organizationId: orgId, targetId: { in: [fresh.id, res.body.data.contact.id] } },
      });
      expect(
        audits.some(
          (a) =>
            a.action === AuditAction.LEAD_UPDATED &&
            (a.metadata as { kind?: string }).kind === 'convert',
        ),
      ).toBe(true);
      expect(audits.some((a) => a.action === AuditAction.CONTACT_CREATED)).toBe(true);
    });

    it('links an existing contact without changing the status when markWon is false', async () => {
      const fresh = (
        await as(ctx, owner, orgId)
          .post('/api/v1/leads')
          .send({ title: 'Link me', status: 'proposal' })
      ).body.data as LeadWithRelations;
      const res = await as(ctx, owner, orgId)
        .post(`/api/v1/leads/${fresh.id}/convert`)
        .send({ contactId: contact.id });
      expect(res.status).toBe(200);
      expect(res.body.data.lead).toMatchObject({ status: 'proposal', contactId: contact.id });
      expect(res.body.data.contact.id).toBe(contact.id);
      const activities = await activitiesOf(fresh.id);
      expect(activities.map((a) => a.type)).toEqual(['converted', 'created']);
    });
  });

  describe('deletion', () => {
    it('a member cannot delete; the owner soft-deletes and every sub-resource turns 404', async () => {
      expect((await as(ctx, member, orgId).delete(`/api/v1/leads/${lead.id}`)).status).toBe(403);
      const res = await as(ctx, owner, orgId).delete(`/api/v1/leads/${lead.id}`);
      expect(res.status).toBe(204);
      expect((await as(ctx, owner, orgId).get(`/api/v1/leads/${lead.id}`)).status).toBe(404);
      expect((await as(ctx, owner, orgId).get(`/api/v1/leads/${lead.id}/notes`)).status).toBe(404);
      expect((await as(ctx, owner, orgId).get(`/api/v1/leads/${lead.id}/activities`)).status).toBe(
        404,
      );
      expect(
        (
          await as(ctx, owner, orgId)
            .post(`/api/v1/leads/${lead.id}/assign`)
            .send({ assigneeId: null })
        ).status,
      ).toBe(404);
      expect((await as(ctx, owner, orgId).delete(`/api/v1/leads/${lead.id}`)).status).toBe(404);
      const list = await as(ctx, owner, orgId).get('/api/v1/leads?pageSize=50');
      expect(list.body.data.some((l: LeadWithRelations) => l.id === lead.id)).toBe(false);
      const row = await ctx.prisma.client.lead.findUnique({ where: { id: lead.id } });
      expect(row?.deletedAt).not.toBeNull();
      expect(
        await ctx.prisma.client.auditLog.count({
          where: { organizationId: orgId, action: AuditAction.LEAD_DELETED, targetId: lead.id },
        }),
      ).toBe(1);
    });
  });
});
