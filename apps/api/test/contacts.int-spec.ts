import { AuditAction, type Contact, ErrorCode, type Role } from '@hilatech/contracts';

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

describe('Contacts', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let outsider: Actor;
  let orgId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    outsider = await register(ctx, { firstName: 'Out', lastName: 'Sider' });
    orgId = (await createOrganization(ctx, owner, 'Contacts Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  let alice: Contact;
  let bob: Contact;

  it('creates contacts (normalising email, defaulting tags/customFields) and audits them', async () => {
    const res = await as(ctx, owner, orgId)
      .post('/api/v1/contacts')
      .send({
        firstName: 'Alice',
        lastName: 'Anderson',
        email: 'Alice@Example.COM',
        company: 'Acme',
        phone: '+972501234567',
        tags: ['vip', 'newsletter'],
        ownerId: member.user.id,
      });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      organizationId: orgId,
      firstName: 'Alice',
      email: 'alice@example.com',
      company: 'Acme',
      tags: ['vip', 'newsletter'],
      customFields: {},
      ownerId: member.user.id,
    });
    expectNoSensitiveLeak(res.body);
    alice = res.body.data;

    const bobRes = await as(ctx, member, orgId)
      .post('/api/v1/contacts')
      .send({ firstName: 'Bob', company: 'Globex', tags: ['newsletter'] });
    expect(bobRes.status).toBe(201);
    expect(bobRes.body.data.ownerId).toBeNull();
    bob = bobRes.body.data;

    const audits = await ctx.prisma.client.auditLog.findMany({
      where: { organizationId: orgId, action: AuditAction.CONTACT_CREATED },
    });
    expect(audits.map((a) => a.targetId).sort()).toEqual([alice.id, bob.id].sort());
  });

  it('rejects an owner who is not an active member with a field-level validation error', async () => {
    const res = await as(ctx, owner, orgId)
      .post('/api/v1/contacts')
      .send({ firstName: 'Nope', ownerId: outsider.user.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'ownerId' })]);

    const invalid = await as(ctx, owner, orgId)
      .post('/api/v1/contacts')
      .send({ firstName: '', email: 'not-an-email' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it('lists with search (case-insensitive across name/email/company/phone), tag and owner filters', async () => {
    const all = await as(ctx, member, orgId).get('/api/v1/contacts');
    expect(all.status).toBe(200);
    expect(all.body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    expect(all.body.data[0].id).toBe(bob.id); // createdAt desc by default

    for (const search of ['alice', 'ANDERSON', 'example.com', 'acme', '50123']) {
      const res = await as(ctx, member, orgId).get(
        `/api/v1/contacts?search=${encodeURIComponent(search)}`,
      );
      expect(res.body.data.map((c: Contact) => c.id)).toEqual([alice.id]);
    }
    const byTag = await as(ctx, member, orgId).get('/api/v1/contacts?tag=vip');
    expect(byTag.body.data.map((c: Contact) => c.id)).toEqual([alice.id]);
    const byOwner = await as(ctx, member, orgId).get(`/api/v1/contacts?ownerId=${member.user.id}`);
    expect(byOwner.body.data.map((c: Contact) => c.id)).toEqual([alice.id]);
    const sorted = await as(ctx, member, orgId).get(
      '/api/v1/contacts?sortBy=firstName&sortOrder=asc',
    );
    expect(sorted.body.data.map((c: Contact) => c.firstName)).toEqual(['Alice', 'Bob']);
  });

  it('GET /contacts/tags returns the distinct tags of the organization', async () => {
    const res = await as(ctx, member, orgId).get('/api/v1/contacts/tags');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(['newsletter', 'vip']);
  });

  it('GET /contacts/:id returns the owner summary and relationship counts', async () => {
    await ctx.prisma.client.lead.createMany({
      data: [
        { organizationId: orgId, title: 'L1', contactId: alice.id },
        { organizationId: orgId, title: 'L2', contactId: alice.id, deletedAt: new Date() },
      ],
    });
    await ctx.prisma.client.conversation.create({
      data: { organizationId: orgId, contactId: alice.id, subject: 'Hi' },
    });
    const res = await as(ctx, member, orgId).get(`/api/v1/contacts/${alice.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: alice.id,
      owner: { id: member.user.id, email: member.email, firstName: 'Mia' },
      leadCount: 1,
      conversationCount: 1,
    });
    expect(res.body.data.owner.passwordHash).toBeUndefined();
    const none = await as(ctx, member, orgId).get(`/api/v1/contacts/${bob.id}`);
    expect(none.body.data).toMatchObject({ owner: null, leadCount: 0, conversationCount: 0 });
    expect((await as(ctx, member, orgId).get(`/api/v1/contacts/${UNKNOWN_ID}`)).status).toBe(404);
    expect((await as(ctx, member, orgId).get('/api/v1/contacts/not-a-uuid')).status).toBe(400);
  });

  it('PATCH updates fields, validates the owner and audits the change', async () => {
    const res = await as(ctx, member, orgId)
      .patch(`/api/v1/contacts/${bob.id}`)
      .send({ jobTitle: 'CTO', tags: ['vip'], ownerId: owner.user.id, customFields: { tier: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      jobTitle: 'CTO',
      tags: ['vip'],
      ownerId: owner.user.id,
      customFields: { tier: 1 },
    });
    const bad = await as(ctx, member, orgId)
      .patch(`/api/v1/contacts/${bob.id}`)
      .send({ ownerId: outsider.user.id });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('ownerId');
    const audit = await ctx.prisma.client.auditLog.findFirst({
      where: { organizationId: orgId, action: AuditAction.CONTACT_UPDATED, targetId: bob.id },
    });
    expect(audit?.metadata).toMatchObject({
      changes: expect.arrayContaining(['jobTitle', 'tags', 'customFields', 'ownerId']),
    });
  });

  it('a member cannot delete; the owner soft-deletes and the contact leaves every listing', async () => {
    const denied = await as(ctx, member, orgId).delete(`/api/v1/contacts/${bob.id}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe(ErrorCode.FORBIDDEN);

    const res = await as(ctx, owner, orgId).delete(`/api/v1/contacts/${bob.id}`);
    expect(res.status).toBe(204);
    const row = await ctx.prisma.client.contact.findUnique({ where: { id: bob.id } });
    expect(row?.deletedAt).not.toBeNull();

    expect((await as(ctx, owner, orgId).get(`/api/v1/contacts/${bob.id}`)).status).toBe(404);
    expect((await as(ctx, owner, orgId).delete(`/api/v1/contacts/${bob.id}`)).status).toBe(404);
    expect(
      (await as(ctx, owner, orgId).patch(`/api/v1/contacts/${bob.id}`).send({ notes: 'x' })).status,
    ).toBe(404);
    const list = await as(ctx, owner, orgId).get('/api/v1/contacts');
    expect(list.body.data.map((c: Contact) => c.id)).toEqual([alice.id]);
    const tags = await as(ctx, owner, orgId).get('/api/v1/contacts/tags');
    expect(tags.body.data).toEqual(['newsletter', 'vip']);
    const audit = await ctx.prisma.client.auditLog.count({
      where: { organizationId: orgId, action: AuditAction.CONTACT_DELETED, targetId: bob.id },
    });
    expect(audit).toBe(1);
  });

  it('requires the organization header and a membership', async () => {
    const noHeader = await as(ctx, owner).get('/api/v1/contacts');
    expect(noHeader.status).toBe(400);
    expect(noHeader.body.error.code).toBe(ErrorCode.ORGANIZATION_REQUIRED);
    const notMember = await as(ctx, outsider, orgId).get('/api/v1/contacts');
    expect(notMember.status).toBe(403);
    expect(notMember.body.error.code).toBe(ErrorCode.NOT_A_MEMBER);
  });
});
