import {
  AuditAction,
  type AuthResponse,
  type ChangePasswordRequest,
  ErrorCode,
  type ForgotPasswordRequest,
  type LoginRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type Session,
  type VerifyEmailRequest,
  idSchema,
} from '@hilatech/contracts';
import { type User } from '@hilatech/database';
import { addMs, generateOpaqueToken, sha256 } from '@hilatech/shared';
import { type Principal } from '@hilatech/types';
import { HttpStatus, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import { AppException } from '../../common/errors/app.exception';
import { type RequestMeta } from '../../common/request';
import { humanizeDuration } from '../../common/utils/duration';
import { AppConfig } from '../../config/app-config.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InvitationRules, InvitationsService } from '../organizations/invitations.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { toAuthUser } from './auth.mappers';
import { type AuthResult, type AuthSession } from './auth.types';
import { LoginThrottleService } from './login-throttle.service';
import { TokenService } from './token.service';

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

@Injectable()
export class AuthService {
  /** Verified against when the email is unknown so response time does not reveal account existence. */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly invitations: InvitationsService,
    private readonly organizations: OrganizationsService,
    private readonly tenancy: TenancyService,
    private readonly config: AppConfig,
    private readonly loginThrottle: LoginThrottleService,
  ) {
    this.dummyHash = hashPassword(generateOpaqueToken(24));
  }

  // ---------------------------------------------------------------------------------------------
  // Register / login / refresh / logout
  // ---------------------------------------------------------------------------------------------

  async register(dto: RegisterRequest, meta: RequestMeta): Promise<AuthResult> {
    const existing = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) throw AppException.conflict('An account with this email already exists');

    const invitation = dto.invitationToken
      ? await this.invitations.findByToken(dto.invitationToken)
      : null;
    if (dto.invitationToken && !invitation) throw AppException.notFound('Invitation');
    if (invitation) {
      InvitationRules.assertAcceptable(invitation, { email: dto.email }, invitation.organization);
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: dto.email, passwordHash, firstName: dto.firstName, lastName: dto.lastName },
      });
      if (invitation) await this.invitations.acceptInTransaction(tx, invitation, created);
      return created;
    });

    await this.audit.log({
      action: AuditAction.AUTH_REGISTER,
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      metadata: { email: user.email, viaInvitation: Boolean(invitation) },
      request: meta,
    });
    if (invitation) await this.invitations.afterAccept(invitation, user, meta);
    await this.sendVerificationEmail(user, meta);

    return this.issue(user, meta);
  }

  async login(dto: LoginRequest, meta: RequestMeta): Promise<AuthResult> {
    // Per-account lockout: refuse before touching the password hash, so a locked account costs nothing.
    if (await this.loginThrottle.isLocked(dto.email)) {
      await this.audit.log({
        action: AuditAction.AUTH_LOGIN_FAILED,
        actorUserId: null,
        metadata: { email: dto.email, reason: 'locked' },
        request: meta,
      });
      throw AppException.rateLimited();
    }
    const user = await this.prisma.client.user.findUnique({ where: { email: dto.email } });
    const valid = user
      ? await argon2.verify(user.passwordHash, dto.password)
      : await this.burnVerify(dto.password);

    if (!user || !valid || !user.isActive) {
      await this.loginThrottle.recordFailure(dto.email);
      await this.audit.log({
        action: AuditAction.AUTH_LOGIN_FAILED,
        actorUserId: user?.id ?? null,
        metadata: {
          email: dto.email,
          reason: !user ? 'unknown_email' : !valid ? 'bad_password' : 'inactive',
        },
        request: meta,
      });
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid email or password',
      );
    }

    await this.loginThrottle.reset(dto.email);
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return this.issue(user, meta, AuditAction.AUTH_LOGIN);
  }

  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<AuthResult> {
    if (!rawToken)
      throw AppException.unauthorized('Missing refresh token', ErrorCode.TOKEN_INVALID);
    const result = await this.tokens.rotate(rawToken, meta);

    switch (result.outcome) {
      case 'invalid':
        throw AppException.unauthorized('Invalid refresh token', ErrorCode.TOKEN_INVALID);
      case 'reused':
        await this.audit.log({
          action: AuditAction.AUTH_REFRESH_REUSE_DETECTED,
          actorUserId: result.userId,
          targetType: 'session',
          targetId: result.familyId,
          metadata: { familyId: result.familyId, revokedCount: result.revokedCount },
          request: meta,
        });
        throw AppException.unauthorized(
          'Refresh token reuse detected; session revoked',
          ErrorCode.TOKEN_REUSED,
        );
      case 'revoked':
        throw AppException.unauthorized('Session has been revoked', ErrorCode.TOKEN_INVALID);
      case 'expired':
        throw AppException.unauthorized('Refresh token expired', ErrorCode.TOKEN_EXPIRED);
      case 'inactive':
        throw AppException.unauthorized('Account is not active');
      case 'rotated': {
        const user = await this.prisma.client.user.findUniqueOrThrow({
          where: { id: result.user.id },
        });
        await this.audit.log({
          action: AuditAction.AUTH_REFRESH,
          actorUserId: user.id,
          targetType: 'session',
          targetId: result.familyId,
          request: meta,
        });
        return {
          body: await this.authResponse(user, result.tokens.accessToken, result.tokens.expiresIn),
          refreshToken: result.tokens.refreshToken,
          refreshExpiresAt: result.tokens.refreshExpiresAt,
        };
      }
    }
  }

  /** Revokes the session family of the presented refresh token (idempotent, never fails the client). */
  async logout(
    rawToken: string | undefined,
    principal: Principal | undefined,
    meta: RequestMeta,
  ): Promise<void> {
    let familyId: string | undefined;
    let userId: string | undefined;
    if (rawToken) {
      const token = await this.tokens.findLive(rawToken);
      if (token) {
        familyId = token.familyId;
        userId = token.userId;
      }
    }
    if (!familyId && principal) {
      familyId = principal.sessionId;
      userId = principal.userId;
    }
    if (!familyId || !userId) return;

    const revoked = await this.tokens.revokeFamily(familyId, userId);
    await this.audit.log({
      action: AuditAction.AUTH_LOGOUT,
      actorUserId: userId,
      targetType: 'session',
      targetId: familyId,
      metadata: { revokedCount: revoked },
      request: meta,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Session info
  // ---------------------------------------------------------------------------------------------

  async me(principal: Principal, organizationHeader: string | undefined): Promise<Session> {
    const user = await this.prisma.client.user.findUnique({ where: { id: principal.userId } });
    if (!user || !user.isActive) throw AppException.unauthorized('Account is not active');
    const organizations = await this.organizations.listForUser(user.id);

    let activeOrganization: Session['activeOrganization'] = null;
    let permissions: string[] = [];
    const selected = idSchema.safeParse(organizationHeader);
    if (selected.success) {
      const tenant = await this.tenancy.resolveTenant(user.id, selected.data);
      if (tenant) {
        activeOrganization = organizations.find((o) => o.id === tenant.organizationId) ?? null;
        permissions = [...tenant.permissions];
      }
    }
    return { user: toAuthUser(user), organizations, activeOrganization, permissions };
  }

  async listSessions(principal: Principal): Promise<AuthSession[]> {
    const now = new Date();
    const [live, families] = await Promise.all([
      this.prisma.client.refreshToken.findMany({
        where: { userId: principal.userId, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.refreshToken.groupBy({
        by: ['familyId'],
        where: { userId: principal.userId },
        _min: { createdAt: true },
      }),
    ]);
    const startedAt = new Map(families.map((f) => [f.familyId, f._min.createdAt ?? now]));
    return live.map((t) => ({
      familyId: t.familyId,
      createdAt: (startedAt.get(t.familyId) ?? t.createdAt).toISOString(),
      lastActiveAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt.toISOString(),
      userAgent: t.userAgent,
      ipAddress: t.ipAddress,
      current: t.familyId === principal.sessionId,
    }));
  }

  async revokeSession(principal: Principal, familyId: string, meta: RequestMeta): Promise<void> {
    const exists = await this.prisma.client.refreshToken.findFirst({
      where: { familyId, userId: principal.userId },
      select: { id: true },
    });
    if (!exists) throw AppException.notFound('Session');
    const revoked = await this.tokens.revokeFamily(familyId, principal.userId);
    await this.audit.log({
      action: AuditAction.AUTH_LOGOUT,
      actorUserId: principal.userId,
      targetType: 'session',
      targetId: familyId,
      metadata: { revokedCount: revoked, remote: familyId !== principal.sessionId },
      request: meta,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Passwords & email verification
  // ---------------------------------------------------------------------------------------------

  /** Always succeeds (202) to avoid account enumeration; emails only when the account exists. */
  async forgotPassword(dto: ForgotPasswordRequest, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.isActive) return;

    const raw = generateOpaqueToken();
    const token = await this.prisma.client.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(raw),
          expiresAt: addMs(new Date(), this.config.get('passwordResetTtlMs')),
        },
      });
    });

    await this.email.send(
      'password_reset',
      user.email,
      {
        token: raw,
        firstName: user.firstName,
        expiresIn: humanizeDuration(this.config.get('passwordResetTtlMs')),
      },
      { idempotencyKey: `email-password-reset-${token.id}`, requestId: meta.requestId },
    );
    await this.audit.log({
      action: AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      request: meta,
    });
  }

  async resetPassword(dto: ResetPasswordRequest, meta: RequestMeta): Promise<void> {
    const token = await this.prisma.client.passwordResetToken.findUnique({
      where: { tokenHash: sha256(dto.token) },
      include: { user: { select: { id: true, isActive: true } } },
    });
    if (!token || token.usedAt || !token.user.isActive) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.TOKEN_INVALID,
        'Invalid or already used reset token',
      );
    }
    if (token.expiresAt <= new Date()) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.TOKEN_EXPIRED,
        'Reset token expired',
      );
    }

    const passwordHash = await hashPassword(dto.password);
    await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.TOKEN_INVALID,
          'Invalid or already used reset token',
        );
      }
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
    });
    // A password reset implies the old credentials may be compromised: every session is revoked.
    await this.tokens.revokeAllForUser(token.userId);
    await this.audit.log({
      action: AuditAction.AUTH_PASSWORD_RESET,
      actorUserId: token.userId,
      targetType: 'user',
      targetId: token.userId,
      request: meta,
    });
  }

  async changePassword(
    principal: Principal,
    dto: ChangePasswordRequest,
    meta: RequestMeta,
  ): Promise<void> {
    const user = await this.prisma.client.user.findUniqueOrThrow({
      where: { id: principal.userId },
    });
    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.INVALID_CREDENTIALS,
        'Current password is incorrect',
      );
    }
    if (dto.currentPassword === dto.newPassword) {
      throw AppException.validation('New password must differ from the current password', [
        { path: 'newPassword', message: 'Must differ from the current password', code: 'custom' },
      ]);
    }
    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(dto.newPassword) },
    });
    const revoked = await this.tokens.revokeAllForUser(user.id, principal.sessionId);
    await this.audit.log({
      action: AuditAction.AUTH_PASSWORD_CHANGED,
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      metadata: { otherSessionsRevoked: revoked },
      request: meta,
    });
  }

  async verifyEmail(dto: VerifyEmailRequest, meta: RequestMeta): Promise<void> {
    const token = await this.prisma.client.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(dto.token) },
    });
    if (!token || token.usedAt) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.TOKEN_INVALID,
        'Invalid or already used verification token',
      );
    }
    if (token.expiresAt <= new Date()) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.TOKEN_EXPIRED,
        'Verification token expired',
      );
    }
    await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.TOKEN_INVALID,
          'Invalid or already used verification token',
        );
      }
      await tx.user.updateMany({
        where: { id: token.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    });
    await this.audit.log({
      action: AuditAction.AUTH_EMAIL_VERIFIED,
      actorUserId: token.userId,
      targetType: 'user',
      targetId: token.userId,
      request: meta,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  private async issue(
    user: User,
    meta: RequestMeta,
    auditAction?: AuditAction,
  ): Promise<AuthResult> {
    const tokens = await this.tokens.createSession(user, meta);
    if (auditAction) {
      await this.audit.log({
        action: auditAction,
        actorUserId: user.id,
        targetType: 'session',
        targetId: tokens.familyId,
        request: meta,
      });
    }
    return {
      body: await this.authResponse(user, tokens.accessToken, tokens.expiresIn),
      refreshToken: tokens.refreshToken,
      refreshExpiresAt: tokens.refreshExpiresAt,
    };
  }

  private async authResponse(
    user: User,
    accessToken: string,
    expiresIn: number,
  ): Promise<AuthResponse> {
    return {
      accessToken,
      expiresIn,
      tokenType: 'Bearer',
      user: toAuthUser(user),
      organizations: await this.organizations.listForUser(user.id),
    };
  }

  /**
   * Sends a fresh verification email to the signed-in user. A no-op for verified accounts; at most one
   * email per `EMAIL_VERIFICATION_RESEND_COOLDOWN` (429 otherwise). Older unused tokens stay valid
   * until they expire, so a link from an earlier email still works.
   */
  async resendVerification(principal: Principal, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { id: principal.userId } });
    if (!user || user.emailVerifiedAt) return;
    const cooldownMs = this.config.get('emailVerificationResendCooldownMs');
    const recent = await this.prisma.client.emailVerificationToken.findFirst({
      where: { userId: user.id, createdAt: { gt: new Date(Date.now() - cooldownMs) } },
      select: { id: true },
    });
    if (recent) throw AppException.rateLimited();
    await this.sendVerificationEmail(user, meta);
    await this.audit.log({
      action: AuditAction.AUTH_EMAIL_VERIFICATION_RESENT,
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      request: meta,
    });
  }

  private async sendVerificationEmail(user: User, meta: RequestMeta): Promise<void> {
    const raw = generateOpaqueToken();
    const token = await this.prisma.client.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: addMs(new Date(), this.config.get('emailVerificationTtlMs')),
      },
    });
    await this.email.send(
      'verify_email',
      user.email,
      {
        token: raw,
        firstName: user.firstName,
        expiresIn: humanizeDuration(this.config.get('emailVerificationTtlMs')),
      },
      { idempotencyKey: `email-verify-${token.id}`, requestId: meta.requestId },
    );
  }

  /** Constant-ish time path for unknown emails. */
  private async burnVerify(password: string): Promise<false> {
    await argon2.verify(await this.dummyHash, password).catch(() => false);
    return false;
  }
}
