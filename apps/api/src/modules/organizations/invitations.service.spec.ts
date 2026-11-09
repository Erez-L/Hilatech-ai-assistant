import { ALL_PERMISSIONS, ErrorCode, QueueName } from '@hilatech/contracts';
import { sha256 } from '@hilatech/shared';

import { AppException } from '../../common/errors/app.exception';
import { type AppConfig } from '../../config/app-config.service';
import { type EmailService } from '../../infrastructure/email/email.service';
import { type QueueService } from '../../infrastructure/queue/queue.service';
import { createAuditMock, createConfigMock, createPrismaMock } from '../../test-utils/prisma.mock';
import { type AuditService } from '../audit/audit.service';
import { type EntitlementsService } from '../billing/entitlements.service';
import { InvitationRules, InvitationsService } from './invitations.service';

const ORG = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';
const ROLE = '33333333-3333-4333-8333-333333333333';
const tenant = {
  organizationId: ORG,
  userId: USER,
  memberId: 'm1',
  roleId: 'r-owner',
  roleKey: 'admin',
  permissions: ALL_PERMISSIONS,
};
const meta = { ipAddress: null, userAgent: null, requestId: 'req' };
const now = new Date();
const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 1_000);
const role = {
  id: ROLE,
  organizationId: ORG,
  key: 'member',
  name: 'Member',
  description: null,
  isSystem: true,
  permissions: [],
  createdAt: now,
  updatedAt: now,
};
const org = { id: ORG, name: 'Acme', slug: 'acme', logoUrl: null, deletedAt: null };

describe('InvitationRules', () => {
  it('computes the effective status (pending past expiry → expired)', () => {
    expect(InvitationRules.effectiveStatus({ status: 'pending', expiresAt: future })).toBe(
      'pending',
    );
    expect(InvitationRules.effectiveStatus({ status: 'pending', expiresAt: past })).toBe('expired');
    expect(InvitationRules.effectiveStatus({ status: 'accepted', expiresAt: past })).toBe(
      'accepted',
    );
  });

  it('assertAcceptable enforces status, expiry, organization and email match (case-insensitive)', () => {
    const inv = { status: 'pending' as const, expiresAt: future, email: 'Invitee@Example.com' };
    expect(() =>
      InvitationRules.assertAcceptable(inv, { email: 'invitee@example.com' }, org),
    ).not.toThrow();
    expect(() =>
      InvitationRules.assertAcceptable(inv, { email: 'other@example.com' }, org),
    ).toThrow(expect.objectContaining({ code: ErrorCode.FORBIDDEN }));
    expect(() =>
      InvitationRules.assertAcceptable({ ...inv, expiresAt: past }, { email: inv.email }, org),
    ).toThrow(expect.objectContaining({ code: ErrorCode.TOKEN_EXPIRED }));
    expect(() =>
      InvitationRules.assertAcceptable({ ...inv, status: 'revoked' }, { email: inv.email }, org),
    ).toThrow(expect.objectContaining({ code: ErrorCode.TOKEN_INVALID }));
    expect(() =>
      InvitationRules.assertAcceptable(inv, { email: inv.email }, { deletedAt: new Date() }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.NOT_FOUND }));
  });
});

describe('InvitationsService', () => {
  function build() {
    const { service: prisma, client } = createPrismaMock();
    const audit = createAuditMock();
    const email = { send: jest.fn().mockResolvedValue({ jobId: 'job' }) };
    const queue = {
      enqueue: jest.fn().mockResolvedValue({ jobId: 'job', queue: QueueName.NOTIFICATIONS }),
    };
    const entitlements = {
      assertWithinLimit: jest.fn().mockResolvedValue({ metric: 'seats', used: 1, limit: 2 }),
    };
    const config = createConfigMock({ invitationTtlMs: 7 * 86_400_000, APP_URL: 'http://app' });
    const service = new InvitationsService(
      prisma,
      audit as unknown as AuditService,
      email as unknown as EmailService,
      queue as unknown as QueueService,
      entitlements as unknown as EntitlementsService,
      config as unknown as AppConfig,
    );
    return { service, client, audit, email, queue, entitlements };
  }

  describe('create', () => {
    it('rejects roles from another organization (scoped lookup)', async () => {
      const { service, client } = build();
      client.role.findFirst.mockResolvedValue(null);
      await expect(
        service.create(tenant, { email: 'x@example.com', roleId: ROLE }, meta),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
      expect(client.role.findFirst).toHaveBeenCalledWith({
        where: { id: ROLE, organizationId: ORG },
      });
    });

    it('only owners may invite owners', async () => {
      const { service, client } = build();
      client.role.findFirst.mockResolvedValue({ ...role, key: 'owner' });
      await expect(
        service.create(tenant, { email: 'x@example.com', roleId: ROLE }, meta),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
    });

    it('rejects existing members and duplicate pending invitations with 409', async () => {
      const { service, client } = build();
      client.role.findFirst.mockResolvedValue(role);
      client.organizationMember.findFirst.mockResolvedValue({ id: 'm' });
      await expect(
        service.create(tenant, { email: 'x@example.com', roleId: ROLE }, meta),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });

      client.organizationMember.findFirst.mockResolvedValue(null);
      client.invitation.findFirst.mockResolvedValue({ id: 'i', expiresAt: future });
      await expect(
        service.create(tenant, { email: 'x@example.com', roleId: ROLE }, meta),
      ).rejects.toMatchObject({ code: ErrorCode.CONFLICT });
    });

    it('propagates the seat entitlement failure before creating anything', async () => {
      const { service, client, entitlements } = build();
      client.role.findFirst.mockResolvedValue(role);
      client.organizationMember.findFirst.mockResolvedValue(null);
      client.invitation.findFirst.mockResolvedValue(null);
      entitlements.assertWithinLimit.mockRejectedValue(AppException.entitlementExceeded('seats'));
      await expect(
        service.create(tenant, { email: 'x@example.com', roleId: ROLE }, meta),
      ).rejects.toMatchObject({ code: ErrorCode.ENTITLEMENT_EXCEEDED });
      expect(client.invitation.create).not.toHaveBeenCalled();
    });

    it('stores only the token hash, returns no token, and sends the raw token via the email job', async () => {
      const { service, client, email, audit } = build();
      client.role.findFirst.mockResolvedValue(role);
      client.organizationMember.findFirst.mockResolvedValue(null);
      client.invitation.findFirst.mockResolvedValue(null);
      client.organization.findUniqueOrThrow.mockResolvedValue({ name: 'Acme' });
      client.user.findUniqueOrThrow.mockResolvedValue({ firstName: 'Ann', lastName: 'Admin' });
      client.invitation.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'inv-1',
          ...data,
          status: 'pending',
          acceptedAt: null,
          createdAt: now,
          updatedAt: now,
          role: { id: ROLE, key: 'member', name: 'Member' },
          invitedBy: { id: USER, firstName: 'Ann', lastName: 'Admin' },
        }),
      );

      const result = await service.create(tenant, { email: 'x@example.com', roleId: ROLE }, meta);

      const [template, to, variables, options] = email.send.mock.calls[0]!;
      expect(template).toBe('invitation');
      expect(to).toBe('x@example.com');
      expect(typeof variables.token).toBe('string');
      expect(client.invitation.create.mock.calls[0]![0].data.tokenHash).toBe(
        sha256(variables.token),
      );
      expect(variables.organizationName).toBe('Acme');
      expect(variables.inviterName).toBe('Ann Admin');
      expect(options.idempotencyKey).toBe('invite-inv-1');
      expect(options.idempotencyKey).not.toContain(':');

      expect(JSON.stringify(result)).not.toContain(variables.token);
      expect(JSON.stringify(result)).not.toContain('tokenHash');
      expect(result.status).toBe('pending');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'member.invited', organizationId: ORG }),
      );
    });
  });

  describe('accept', () => {
    const invitation = {
      id: 'inv-1',
      organizationId: ORG,
      email: 'x@example.com',
      roleId: ROLE,
      tokenHash: sha256('raw-token-1234567890'),
      status: 'pending' as const,
      invitedByUserId: 'inviter',
      expiresAt: future,
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
      organization: {
        ...org,
        industry: null,
        timezone: 'UTC',
        locale: 'en',
        website: null,
        description: null,
        settings: {},
        createdAt: now,
        updatedAt: now,
      },
      role,
      invitedBy: { id: 'inviter', firstName: 'Ann', lastName: 'Admin', email: 'ann@example.com' },
    };
    const principal = { userId: USER, email: 'x@example.com', sessionId: 's' };

    it('rejects a mismatching account email with 403 and does not create a membership', async () => {
      const { service, client } = build();
      client.invitation.findUnique.mockResolvedValue(invitation);
      client.user.findUniqueOrThrow.mockResolvedValue({
        id: USER,
        email: 'someone-else@example.com',
        firstName: 'S',
        lastName: 'E',
      });
      await expect(service.accept(principal, 'raw-token-1234567890', meta)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
      expect(client.organizationMember.create).not.toHaveBeenCalled();
    });

    it('creates the membership, marks the invitation accepted, audits member.joined and notifies the inviter', async () => {
      const { service, client, audit, queue } = build();
      client.invitation.findUnique.mockResolvedValue(invitation);
      client.user.findUniqueOrThrow.mockResolvedValue({
        id: USER,
        email: 'X@example.com',
        firstName: 'Xavier',
        lastName: 'Invitee',
      });
      client.organizationMember.findUnique.mockResolvedValue(null);
      client.invitation.updateMany.mockResolvedValue({ count: 1 });
      client.organizationMember.create.mockResolvedValue({ id: 'm-new' });

      const summary = await service.accept(principal, 'raw-token-1234567890', meta);
      expect(summary).toEqual({
        id: ORG,
        name: 'Acme',
        slug: 'acme',
        logoUrl: null,
        roleKey: 'member',
        roleName: 'Member',
      });
      expect(client.invitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-1', status: 'pending' } }),
      );
      expect(client.organizationMember.create).toHaveBeenCalledWith({
        data: { organizationId: ORG, userId: USER, roleId: ROLE, status: 'active' },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'member.joined',
          organizationId: ORG,
          actorUserId: USER,
        }),
      );
      const [queueName, payload] = queue.enqueue.mock.calls[0]!;
      expect(queueName).toBe(QueueName.NOTIFICATIONS);
      expect(payload.userId).toBe('inviter');
      expect(payload.type).toBe('member_joined');
      expect(payload.idempotencyKey).toBe('notif-member-joined-inv-1');
    });

    it('rejects when the user is already a member', async () => {
      const { service, client } = build();
      client.invitation.findUnique.mockResolvedValue(invitation);
      client.user.findUniqueOrThrow.mockResolvedValue({
        id: USER,
        email: 'x@example.com',
        firstName: 'X',
        lastName: 'I',
      });
      client.organizationMember.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.accept(principal, 'raw-token-1234567890', meta)).rejects.toMatchObject({
        code: ErrorCode.CONFLICT,
      });
    });
  });

  it('preview reveals only invitee-facing fields and persists lazy expiry', async () => {
    const { service, client } = build();
    client.invitation.findUnique.mockResolvedValue({
      id: 'inv-1',
      email: 'x@example.com',
      status: 'pending',
      expiresAt: past,
      tokenHash: 'h',
      organization: org,
      role,
    });
    client.invitation.update.mockResolvedValue({});
    const preview = await service.preview('raw-token-1234567890');
    expect(preview).toEqual({
      email: 'x@example.com',
      organizationName: 'Acme',
      roleName: 'Member',
      expiresAt: past.toISOString(),
      status: 'expired',
    });
    expect(client.invitation.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { status: 'expired' },
    });
  });
});
