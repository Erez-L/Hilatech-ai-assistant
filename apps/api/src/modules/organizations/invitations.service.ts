import {
  AuditAction,
  type CreateInvitationRequest,
  ErrorCode,
  type Invitation as InvitationDto,
  type InvitationPreview,
  type NotificationType,
  type OrganizationSummary,
  type PaginationQuery,
  QueueName,
  SystemRole,
} from '@hilatech/contracts';
import {
  type Invitation,
  type Organization,
  type Prisma,
  type PrismaClient,
  type Role,
  type User,
} from '@hilatech/database';
import { addMs, generateOpaqueToken, sha256, truncate } from '@hilatech/shared';
import { type Principal, type TenantContext } from '@hilatech/types';
import { HttpStatus, Injectable, Optional } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { humanizeDuration } from '../../common/utils/duration';
import { AppConfig } from '../../config/app-config.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { DomainEventsService } from '../events/domain-events.service';
import { INVITATION_INCLUDE, toInvitation } from './organizations.mappers';

type Tx = Prisma.TransactionClient | PrismaClient;

export type InvitationWithContext = Invitation & {
  organization: Organization;
  role: Role;
  invitedBy: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;
};

export type InviteeUser = Pick<User, 'id' | 'email' | 'firstName' | 'lastName'>;

/** Pure checks shared by `accept` and registration-with-invitation; exported for unit tests. */
export const InvitationRules = {
  /** Returns the effective status, treating a pending-but-past-expiry invitation as expired. */
  effectiveStatus(
    inv: Pick<Invitation, 'status' | 'expiresAt'>,
    now = new Date(),
  ): Invitation['status'] {
    if (inv.status === 'pending' && inv.expiresAt <= now) return 'expired';
    return inv.status;
  },
  assertAcceptable(
    inv: Pick<Invitation, 'status' | 'expiresAt' | 'email'>,
    user: Pick<User, 'email'>,
    organization: Pick<Organization, 'deletedAt'>,
    now = new Date(),
  ): void {
    const status = InvitationRules.effectiveStatus(inv, now);
    if (status === 'expired') {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.TOKEN_EXPIRED,
        'This invitation has expired',
      );
    }
    if (status !== 'pending') {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.TOKEN_INVALID,
        'This invitation is no longer valid',
      );
    }
    if (organization.deletedAt) throw AppException.notFound('Organization');
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      throw AppException.forbidden('This invitation was sent to a different email address');
    }
  },
};

@Injectable()
export class InvitationsService {
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly queue: QueueService,
    private readonly entitlements: EntitlementsService,
    config: AppConfig,
    @Optional() private readonly events?: DomainEventsService,
  ) {
    this.ttlMs = config.get('invitationTtlMs');
  }

  async list(tenant: TenantContext, query: PaginationQuery): Promise<PageResult<InvitationDto>> {
    const where = { organizationId: tenant.organizationId };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.invitation.findMany({
        where,
        include: INVITATION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.invitation.count({ where }),
    ]);
    const now = new Date();
    return page(
      rows.map((r) => toInvitation({ ...r, status: InvitationRules.effectiveStatus(r, now) })),
      query,
      total,
    );
  }

  /**
   * Creates an invitation. The raw token is delivered ONLY inside the email job payload (and the
   * development log driver); the database stores its SHA-256.
   */
  async create(
    tenant: TenantContext,
    dto: CreateInvitationRequest,
    meta: RequestMeta,
  ): Promise<InvitationDto> {
    const role = await this.prisma.client.role.findFirst({
      where: { id: dto.roleId, organizationId: tenant.organizationId },
    });
    if (!role) {
      throw AppException.validation('Role not found in this organization', [
        { path: 'roleId', message: 'Unknown role', code: 'custom' },
      ]);
    }
    if (role.key === SystemRole.OWNER && tenant.roleKey !== SystemRole.OWNER) {
      throw AppException.forbidden('Only an owner can invite another owner');
    }

    const existingMember = await this.prisma.client.organizationMember.findFirst({
      where: { organizationId: tenant.organizationId, user: { email: dto.email } },
      select: { id: true },
    });
    if (existingMember)
      throw AppException.conflict('This user is already a member of the organization');

    const now = new Date();
    const pending = await this.prisma.client.invitation.findFirst({
      where: { organizationId: tenant.organizationId, email: dto.email, status: 'pending' },
    });
    if (pending) {
      if (pending.expiresAt > now)
        throw AppException.conflict('An invitation is already pending for this email');
      await this.prisma.client.invitation.update({
        where: { id: pending.id },
        data: { status: 'expired' },
      });
    }

    await this.entitlements.assertWithinLimit(tenant, 'seats');

    const [organization, inviter] = await Promise.all([
      this.prisma.client.organization.findUniqueOrThrow({
        where: { id: tenant.organizationId },
        select: { name: true },
      }),
      this.prisma.client.user.findUniqueOrThrow({
        where: { id: tenant.userId },
        select: { firstName: true, lastName: true },
      }),
    ]);

    const rawToken = generateOpaqueToken();
    const invitation = await this.prisma.client.invitation.create({
      data: {
        organizationId: tenant.organizationId,
        email: dto.email,
        roleId: role.id,
        tokenHash: sha256(rawToken),
        invitedByUserId: tenant.userId,
        expiresAt: addMs(now, this.ttlMs),
      },
      include: INVITATION_INCLUDE,
    });

    await this.email.send(
      'invitation',
      invitation.email,
      {
        token: rawToken,
        organizationName: organization.name,
        roleName: role.name,
        inviterName: `${inviter.firstName} ${inviter.lastName}`.trim(),
        expiresIn: humanizeDuration(this.ttlMs),
      },
      {
        idempotencyKey: `invite-${invitation.id}`,
        organizationId: tenant.organizationId,
        requestId: meta.requestId,
      },
    );

    await this.audit.log({
      action: AuditAction.MEMBER_INVITED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'invitation',
      targetId: invitation.id,
      metadata: { email: invitation.email, roleKey: role.key },
      request: meta,
    });
    return toInvitation(invitation);
  }

  async revoke(tenant: TenantContext, invitationId: string, meta: RequestMeta): Promise<void> {
    const invitation = await this.prisma.client.invitation.findFirst({
      where: { id: invitationId, organizationId: tenant.organizationId },
    });
    if (!invitation) throw AppException.notFound('Invitation');
    if (invitation.status !== 'pending') {
      throw AppException.conflict(
        `Only pending invitations can be revoked (current status: ${invitation.status})`,
      );
    }
    await this.prisma.client.invitation.update({
      where: { id: invitation.id },
      data: { status: 'revoked' },
    });
    await this.audit.log({
      action: AuditAction.INVITATION_REVOKED,
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      targetType: 'invitation',
      targetId: invitation.id,
      metadata: { email: invitation.email },
      request: meta,
    });
  }

  /** Public, unauthenticated lookup used by the accept page. Reveals only what the invitee needs. */
  async preview(rawToken: string): Promise<InvitationPreview> {
    const invitation = await this.findByToken(rawToken);
    if (!invitation || invitation.organization.deletedAt) throw AppException.notFound('Invitation');
    const status = await this.syncExpiry(invitation);
    return {
      email: invitation.email,
      organizationName: invitation.organization.name,
      roleName: invitation.role.name,
      expiresAt: invitation.expiresAt.toISOString(),
      status,
    };
  }

  /** Authenticated acceptance: the caller's email must match the invitee. */
  async accept(
    principal: Principal,
    rawToken: string,
    meta: RequestMeta,
  ): Promise<OrganizationSummary> {
    const invitation = await this.findByToken(rawToken);
    if (!invitation) throw AppException.notFound('Invitation');
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    await this.syncExpiry(invitation);
    InvitationRules.assertAcceptable(invitation, user, invitation.organization);

    const already = await this.prisma.client.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: invitation.organizationId, userId: user.id },
      },
      select: { id: true },
    });
    if (already) throw AppException.conflict('You are already a member of this organization');

    await this.prisma.client.$transaction((tx) => this.acceptInTransaction(tx, invitation, user));
    await this.afterAccept(invitation, user, meta);

    return {
      id: invitation.organization.id,
      name: invitation.organization.name,
      slug: invitation.organization.slug,
      logoUrl: invitation.organization.logoUrl,
      roleKey: invitation.role.key,
      roleName: invitation.role.name,
    };
  }

  /** Loads an invitation by raw token with the context needed for acceptance (or null). */
  async findByToken(rawToken: string): Promise<InvitationWithContext | null> {
    return this.prisma.client.invitation.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: {
        organization: true,
        role: true,
        invitedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  /** Creates the membership and marks the invitation accepted. Caller validates with `InvitationRules` first. */
  async acceptInTransaction(
    tx: Tx,
    invitation: InvitationWithContext,
    user: InviteeUser,
  ): Promise<void> {
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'pending' },
      data: { status: 'accepted', acceptedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.TOKEN_INVALID,
        'This invitation is no longer valid',
      );
    }
    await tx.organizationMember.create({
      data: {
        organizationId: invitation.organizationId,
        userId: user.id,
        roleId: invitation.roleId,
        status: 'active',
      },
    });
  }

  /** Audit + notification to the inviter. Runs after the transaction committed. */
  async afterAccept(
    invitation: InvitationWithContext,
    user: InviteeUser,
    meta: RequestMeta,
  ): Promise<void> {
    await this.audit.log({
      action: AuditAction.MEMBER_JOINED,
      organizationId: invitation.organizationId,
      actorUserId: user.id,
      targetType: 'invitation',
      targetId: invitation.id,
      metadata: { email: user.email, roleKey: invitation.role.key },
      request: meta,
    });
    await this.events?.emit(
      invitation.organizationId,
      'member.joined',
      { userId: user.id, email: user.email, roleKey: invitation.role.key, invitationId: invitation.id },
      { actorUserId: user.id, requestId: meta.requestId },
    );
    await this.queue.enqueue(QueueName.NOTIFICATIONS, {
      organizationId: invitation.organizationId,
      idempotencyKey: `notif-member-joined-${invitation.id}`,
      requestId: meta.requestId ?? undefined,
      enqueuedAt: new Date().toISOString(),
      userId: invitation.invitedBy.id,
      type: 'member_joined' satisfies NotificationType,
      title: truncate(
        `${user.firstName} ${user.lastName} joined ${invitation.organization.name}`,
        200,
      ),
      body: `${user.email} accepted your invitation as ${invitation.role.name}.`,
      link: '/members',
      data: {
        organizationId: invitation.organizationId,
        userId: user.id,
        invitationId: invitation.id,
      },
    });
  }

  private async syncExpiry(invitation: InvitationWithContext): Promise<Invitation['status']> {
    const status = InvitationRules.effectiveStatus(invitation);
    if (status === 'expired' && invitation.status === 'pending') {
      await this.prisma.client.invitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      });
      invitation.status = 'expired';
    }
    return status;
  }
}
