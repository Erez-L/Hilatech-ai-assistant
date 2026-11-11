import { AuditAction, QueueName, type Role, type TaskWithRelations } from '@hilatech/contracts';

import {
  type Actor,
  type TestContext,
  as,
  createOrganization,
  createTestApp,
  jobsOn,
  register,
  resetDatabase,
} from './setup/test-app';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Tasks', () => {
  let ctx: TestContext;
  let owner: Actor;
  let member: Actor;
  let other: Actor;
  let orgId: string;
  let otherOrgId: string;
  let contactId: string;
  let leadId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    owner = await register(ctx, { firstName: 'Owen', lastName: 'Owner' });
    member = await register(ctx, { firstName: 'Mia', lastName: 'Member' });
    other = await register(ctx, { firstName: 'Oscar', lastName: 'Other' });
    orgId = (await createOrganization(ctx, owner, 'Tasks Co')).id;
    otherOrgId = (await createOrganization(ctx, other, 'Other Co')).id;
    const roles = (await as(ctx, owner, orgId).get('/api/v1/roles')).body.data as Role[];
    await ctx.prisma.client.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: member.user.id,
        roleId: roles.find((r) => r.key === 'member')!.id,
        status: 'active',
      },
    });
    contactId = (
      await as(ctx, owner, orgId)
        .post('/api/v1/contacts')
        .send({ firstName: 'Dana', email: 'dana@tasks.test' })
    ).body.data.id;
    leadId = (await as(ctx, owner, orgId).post('/api/v1/leads').send({ title: 'Lead for tasks' }))
      .body.data.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function events(name: string) {
    const jobs = await jobsOn(ctx, QueueName.AUTOMATION);
    return jobs.filter(
      (j) => j.data.kind === 'event' && j.data.event === name && j.data.organizationId === orgId,
    );
  }

  let task: TaskWithRelations;

  it('creates a task with related entities, defaults, audit and a task.created event', async () => {
    const res = await as(ctx, member, orgId).post('/api/v1/tasks').send({
      title: 'Call Dana',
      priority: 'high',
      dueAt: '2030-01-10T10:00:00.000Z',
      reminderAt: '2030-01-10T09:00:00.000Z',
      contactId,
      leadId,
    });
    expect(res.status).toBe(201);
    task = res.body.data;
    expect(task).toMatchObject({
      organizationId: orgId,
      title: 'Call Dana',
      status: 'todo',
      priority: 'high',
      source: 'human',
      contactId,
      leadId,
      isOverdue: false,
      createdBy: { id: member.user.id },
      contact: { id: contactId },
      lead: { id: leadId, title: 'Lead for tasks' },
    });
    expect(
      await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.TASK_CREATED, targetId: task.id },
      }),
    ).toBe(1);
    const ev = (await events('task.created')).find(
      (e) => (e.data.payload as { taskId: string }).taskId === task.id,
    );
    expect(ev?.data).toMatchObject({
      actorUserId: member.user.id,
      payload: { taskId: task.id, title: 'Call Dana' },
    });
  });

  it('validates input: reminder after due, foreign/unknown references and assignees', async () => {
    const bad = await as(ctx, owner, orgId).post('/api/v1/tasks').send({
      title: 'x',
      dueAt: '2030-01-01T00:00:00.000Z',
      reminderAt: '2030-02-01T00:00:00.000Z',
    });
    expect(bad.status).toBe(400);
    for (const body of [
      { contactId: UNKNOWN_ID },
      { leadId: UNKNOWN_ID },
      { dealId: UNKNOWN_ID },
      { conversationId: UNKNOWN_ID },
      { assigneeId: other.user.id },
    ]) {
      const res = await as(ctx, owner, orgId)
        .post('/api/v1/tasks')
        .send({ title: 'bad ref', ...body });
      expect(res.status).toBe(400);
    }
  });

  it('members can take a task themselves but need tasks:assign to give it to others', async () => {
    const own = await as(ctx, member, orgId)
      .post('/api/v1/tasks')
      .send({ title: 'Mine', assigneeId: member.user.id });
    expect(own.status).toBe(201);
    expect(own.body.data.assignee.id).toBe(member.user.id);
    const forOther = await as(ctx, member, orgId)
      .post('/api/v1/tasks')
      .send({ title: 'For owner', assigneeId: owner.user.id });
    expect(forOther.status).toBe(403);
    const byOwner = await as(ctx, owner, orgId)
      .post('/api/v1/tasks')
      .send({ title: 'For member', assigneeId: member.user.id });
    expect(byOwner.status).toBe(201);
    // assignee gets an in-app notification
    const notes = await ctx.prisma.client.notification.findMany({
      where: { userId: member.user.id, type: 'task_assigned', organizationId: orgId },
    });
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });

  it('lists with filters, pagination and sorting', async () => {
    await as(ctx, owner, orgId)
      .post('/api/v1/tasks')
      .send({ title: 'Overdue one', dueAt: '2020-01-01T00:00:00.000Z', assigneeId: owner.user.id });
    await as(ctx, owner, orgId)
      .post('/api/v1/tasks')
      .send({ title: 'Urgent later', priority: 'urgent', dueAt: '2031-05-05T00:00:00.000Z' });

    const all = await as(ctx, owner, orgId).get(
      '/api/v1/tasks?pageSize=2&page=1&sortBy=title&sortOrder=asc',
    );
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(5);

    const overdue = await as(ctx, owner, orgId).get('/api/v1/tasks?overdue=true');
    expect(overdue.body.data.map((t: TaskWithRelations) => t.title)).toEqual(['Overdue one']);
    expect(overdue.body.data[0].isOverdue).toBe(true);

    const mine = await as(ctx, member, orgId).get('/api/v1/tasks?assigneeId=me');
    expect(mine.body.data.every((t: TaskWithRelations) => t.assignee?.id === member.user.id)).toBe(
      true,
    );

    const byContact = await as(ctx, owner, orgId).get(`/api/v1/tasks?contactId=${contactId}`);
    expect(byContact.body.data.map((t: TaskWithRelations) => t.id)).toEqual([task.id]);

    const due = await as(ctx, owner, orgId).get(
      `/api/v1/tasks?dueFrom=${encodeURIComponent('2030-01-01T00:00:00.000Z')}&dueTo=${encodeURIComponent('2030-12-31T00:00:00.000Z')}`,
    );
    expect(due.body.data.map((t: TaskWithRelations) => t.id)).toEqual([task.id]);

    const unassigned = await as(ctx, owner, orgId).get(
      '/api/v1/tasks?unassigned=true&priority=urgent',
    );
    expect(unassigned.body.data.map((t: TaskWithRelations) => t.title)).toEqual(['Urgent later']);

    const search = await as(ctx, owner, orgId).get(
      '/api/v1/tasks?search=dana&status=todo,in_progress',
    );
    expect(search.body.data.map((t: TaskWithRelations) => t.id)).toEqual([task.id]);
  });

  it('updates, resets the reminder marker when reminderAt changes, and audits', async () => {
    await ctx.prisma.client.task.update({
      where: { id: task.id },
      data: { reminderSentAt: new Date() },
    });
    const same = await as(ctx, owner, orgId)
      .patch(`/api/v1/tasks/${task.id}`)
      .send({ title: 'Call Dana now', status: 'in_progress' });
    expect(same.status).toBe(200);
    expect(same.body.data).toMatchObject({ title: 'Call Dana now', status: 'in_progress' });
    expect(
      (await ctx.prisma.client.task.findUniqueOrThrow({ where: { id: task.id } })).reminderSentAt,
    ).not.toBeNull();

    const moved = await as(ctx, owner, orgId)
      .patch(`/api/v1/tasks/${task.id}`)
      .send({ reminderAt: '2030-01-10T08:00:00.000Z' });
    expect(moved.status).toBe(200);
    expect(
      (await ctx.prisma.client.task.findUniqueOrThrow({ where: { id: task.id } })).reminderSentAt,
    ).toBeNull();
    expect(
      await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.TASK_UPDATED, targetId: task.id },
      }),
    ).toBe(2);
    const clear = await as(ctx, owner, orgId)
      .patch(`/api/v1/tasks/${task.id}`)
      .send({ dueAt: null, reminderAt: null, contactId: null });
    expect(clear.body.data).toMatchObject({ dueAt: null, reminderAt: null, contactId: null });
  });

  it('completes once (one task.completed event), reopens, and rejects status=done through PATCH', async () => {
    const before = (await events('task.completed')).length;
    const done = await as(ctx, member, orgId).post(`/api/v1/tasks/${task.id}/complete`).send();
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'done' });
    expect(done.body.data.completedAt).toBeTruthy();
    const again = await as(ctx, member, orgId).post(`/api/v1/tasks/${task.id}/complete`).send();
    expect(again.status).toBe(200);
    const completed = (await events('task.completed')).filter(
      (e) => (e.data.payload as { taskId: string }).taskId === task.id,
    );
    expect(completed.length).toBe(1);
    expect((await events('task.completed')).length).toBe(before + 1);
    expect(
      await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.TASK_COMPLETED, targetId: task.id },
      }),
    ).toBe(1);

    const patchDone = await as(ctx, owner, orgId)
      .patch(`/api/v1/tasks/${task.id}`)
      .send({ status: 'done' });
    expect(patchDone.status).toBe(400);

    const reopened = await as(ctx, member, orgId).post(`/api/v1/tasks/${task.id}/reopen`).send();
    expect(reopened.body.data).toMatchObject({ status: 'todo', completedAt: null });
  });

  it('bulk-assigns (needs tasks:assign), reports unchanged / not found, and never touches foreign tasks', async () => {
    const t1 = (await as(ctx, owner, orgId).post('/api/v1/tasks').send({ title: 'B1' })).body.data
      .id;
    const t2 = (
      await as(ctx, owner, orgId)
        .post('/api/v1/tasks')
        .send({ title: 'B2', assigneeId: member.user.id })
    ).body.data.id;
    const foreign = (
      await as(ctx, other, otherOrgId).post('/api/v1/tasks').send({ title: 'Foreign' })
    ).body.data.id;

    const denied = await as(ctx, member, orgId)
      .post('/api/v1/tasks/bulk-assign')
      .send({ taskIds: [t1], assigneeId: member.user.id });
    expect(denied.status).toBe(403);

    const res = await as(ctx, owner, orgId)
      .post('/api/v1/tasks/bulk-assign')
      .send({ taskIds: [t1, t2, foreign, UNKNOWN_ID], assigneeId: member.user.id });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(1);
    expect(res.body.data.unchanged).toEqual([t2]);
    expect(res.body.data.notFound.sort()).toEqual([foreign, UNKNOWN_ID].sort());
    expect((await ctx.prisma.client.task.findUniqueOrThrow({ where: { id: t1 } })).assigneeId).toBe(
      member.user.id,
    );
    expect(
      (await ctx.prisma.client.task.findUniqueOrThrow({ where: { id: foreign } })).assigneeId,
    ).toBeNull();

    const badAssignee = await as(ctx, owner, orgId)
      .post('/api/v1/tasks/bulk-assign')
      .send({ taskIds: [t1], assigneeId: other.user.id });
    expect(badAssignee.status).toBe(400);
    expect(
      await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.TASK_BULK_ASSIGNED },
      }),
    ).toBe(1);
  });

  it('deletes only with tasks:delete (members cannot) and audits', async () => {
    const id = (await as(ctx, owner, orgId).post('/api/v1/tasks').send({ title: 'To delete' })).body
      .data.id;
    expect((await as(ctx, member, orgId).delete(`/api/v1/tasks/${id}`)).status).toBe(403);
    expect((await as(ctx, owner, orgId).delete(`/api/v1/tasks/${id}`)).status).toBe(204);
    expect((await as(ctx, owner, orgId).get(`/api/v1/tasks/${id}`)).status).toBe(404);
    expect(
      await ctx.prisma.client.auditLog.count({
        where: { organizationId: orgId, action: AuditAction.TASK_DELETED, targetId: id },
      }),
    ).toBe(1);
  });
});
