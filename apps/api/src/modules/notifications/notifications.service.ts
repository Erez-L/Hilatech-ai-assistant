import {
  type ListNotificationsQuery,
  type Notification as NotificationDto,
  type NotificationPreferences,
  NotificationType,
  type UnreadCount,
} from '@hilatech/contracts';
import { type Notification, type Prisma } from '@hilatech/database';
import { isSafeAppPath, truncate } from '@hilatech/shared';
import { type Principal, type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AppException } from '../../common/errors/app.exception';
import { type PageResult, page, skipTake } from '../../common/utils/pagination';
import { EmailService } from '../../infrastructure/email/email.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DEFAULT_PREFERENCES, userPreferencesSchema } from '../users/users.schemas';
import { jsonObject } from '../crm/crm.mappers';
import { NotificationRules } from './notification.rules';

export interface NotifyInput {
  /** Organization the event belongs to (`null` for platform-wide notifications). */
  organizationId: string | null;
  /** Recipient. */
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** App-relative link (e.g. `/leads/<id>`); the web app and the email worker resolve it against APP_URL. */
  link?: string;
  data?: Record<string, unknown>;
  /** Stable key so a retried business operation does not email twice. Defaults to the notification id. */
  idempotencyKey?: string;
  requestId?: string | null;
}

export interface ReadAllResult {
  updated: number;
}

/**
 * In-app notifications.
 *
 * In-app rows are written SYNCHRONOUSLY by the API (not through the `notifications` BullMQ queue, which
 * exists for events produced by the workers themselves): the business operation that triggers a
 * notification — a lead or conversation assignment — already runs in a request, and the recipient
 * expects to see the badge immediately. Only the optional email copy is handed to the queue
 * (through `EmailService`), and only when the user explicitly enabled email for that type.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly logger: Logger,
  ) {}

  /**
   * Delivers a notification to one user, honouring their preferences. Never throws: a notification
   * failure must not fail the business operation that produced it.
   */
  async notify(input: NotifyInput): Promise<NotificationDto | null> {
    try {
      return await this.deliver(input);
    } catch (error) {
      this.logger.error(
        { err: error, type: input.type, userId: input.userId },
        'Failed to deliver notification',
        NotificationsService.name,
      );
      return null;
    }
  }

  private async deliver(input: NotifyInput): Promise<NotificationDto | null> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: input.userId, isActive: true },
      select: { id: true, email: true, preferences: true },
    });
    if (!user) return null;

    // Links are app-relative by contract; never persist or email anything that could leave the origin.
    const link = input.link && isSafeAppPath(input.link) ? input.link : null;
    const prefs = NotificationRules.preferencesFrom(user.preferences);
    let created: Notification | null = null;
    if (NotificationRules.inAppEnabled(prefs, input.type)) {
      created = await this.prisma.client.notification.create({
        data: {
          organizationId: input.organizationId,
          userId: user.id,
          type: input.type,
          title: truncate(input.title, 200),
          body: input.body ?? null,
          link,
          data: (input.data ?? {}) as Prisma.InputJsonObject,
        },
      });
    }

    if (NotificationRules.emailEnabled(prefs, input.type)) {
      const key = input.idempotencyKey ?? created?.id ?? `${input.type}-${user.id}-${Date.now()}`;
      await this.email.send(
        'generic',
        user.email,
        {
          subject: truncate(input.title, 200),
          heading: truncate(input.title, 200),
          body: input.body ?? input.title,
          ...(link ? { ctaLabel: 'Open', ctaUrl: link } : {}),
        },
        {
          idempotencyKey: `notif-email-${key}`,
          organizationId: input.organizationId,
          requestId: input.requestId ?? null,
        },
      );
    }

    return created ? toNotification(created) : null;
  }

  /** The caller's notifications for the selected organization plus platform-wide (organization-less) ones. */
  async list(
    tenant: TenantContext,
    query: ListNotificationsQuery,
  ): Promise<PageResult<NotificationDto>> {
    const where: Prisma.NotificationWhereInput = {
      ...this.scope(tenant),
      ...(query.unread ? { readAt: null } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...skipTake(query),
      }),
      this.prisma.client.notification.count({ where }),
    ]);
    return page(rows.map(toNotification), query, total);
  }

  async unreadCount(tenant: TenantContext): Promise<UnreadCount> {
    const unread = await this.prisma.client.notification.count({
      where: { ...this.scope(tenant), readAt: null },
    });
    return { unread };
  }

  /** Marks one of the caller's notifications as read. Foreign rows are indistinguishable from missing ones. */
  async markRead(tenant: TenantContext, id: string): Promise<NotificationDto> {
    const existing = await this.prisma.client.notification.findFirst({
      where: { id, ...this.scope(tenant) },
    });
    if (!existing) throw AppException.notFound('Notification');
    if (existing.readAt) return toNotification(existing);
    const updated = await this.prisma.client.notification.update({
      where: { id: existing.id },
      data: { readAt: new Date() },
    });
    return toNotification(updated);
  }

  async markAllRead(tenant: TenantContext): Promise<ReadAllResult> {
    const result = await this.prisma.client.notification.updateMany({
      where: { ...this.scope(tenant), readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  /** Notification preferences live under the `notifications` key of `User.preferences`. */
  async getPreferences(principal: Principal): Promise<NotificationPreferences> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: principal.userId },
      select: { preferences: true },
    });
    if (!user) throw AppException.notFound('User');
    return NotificationRules.preferencesFrom(user.preferences);
  }

  /** Replaces the `notifications` key, preserving the other user preferences (theme, locale…). */
  async replacePreferences(
    principal: Principal,
    preferences: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: principal.userId },
      select: { preferences: true },
    });
    if (!user) throw AppException.notFound('User');
    const parsed = userPreferencesSchema.safeParse(user.preferences ?? {});
    const current = parsed.success
      ? parsed.data
      : { ...DEFAULT_PREFERENCES, ...jsonObject(user.preferences) };
    const next = { ...current, notifications: preferences };
    await this.prisma.client.user.update({
      where: { id: principal.userId },
      data: { preferences: next as Prisma.InputJsonObject },
    });
    return preferences;
  }

  private scope(tenant: TenantContext): Prisma.NotificationWhereInput {
    return {
      userId: tenant.userId,
      OR: [{ organizationId: tenant.organizationId }, { organizationId: null }],
    };
  }
}

export function toNotification(row: Notification): NotificationDto {
  const type = NotificationType.safeParse(row.type);
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    // Rows are only ever written with contract types; fall back to `system` for defensive serialisation.
    type: type.success ? type.data : 'system',
    title: row.title,
    body: row.body,
    link: row.link,
    data: jsonObject(row.data),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
