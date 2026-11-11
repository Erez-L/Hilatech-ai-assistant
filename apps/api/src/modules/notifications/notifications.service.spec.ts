import { createLoggerMock, createPrismaMock } from '../../test-utils/prisma.mock';
import { type EmailService } from '../../infrastructure/email/email.service';
import { NotificationRules } from './notification.rules';
import { NotificationsService } from './notifications.service';

const ORG = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-01T10:00:00Z');

describe('NotificationRules', () => {
  it('reads the notifications key leniently', () => {
    expect(NotificationRules.preferencesFrom(undefined)).toEqual({});
    expect(NotificationRules.preferencesFrom({ theme: 'dark' })).toEqual({});
    expect(NotificationRules.preferencesFrom({ notifications: 'garbage' })).toEqual({});
    expect(
      NotificationRules.preferencesFrom({ notifications: { inApp: { lead_assigned: false } } }),
    ).toEqual({ inApp: { lead_assigned: false } });
  });

  it('in-app defaults to enabled, email defaults to disabled', () => {
    expect(NotificationRules.inAppEnabled({}, 'lead_assigned')).toBe(true);
    expect(
      NotificationRules.inAppEnabled({ inApp: { lead_assigned: false } }, 'lead_assigned'),
    ).toBe(false);
    expect(NotificationRules.inAppEnabled({ inApp: { system: false } }, 'lead_assigned')).toBe(
      true,
    );
    expect(NotificationRules.emailEnabled({}, 'lead_assigned')).toBe(false);
    expect(
      NotificationRules.emailEnabled({ email: { lead_assigned: true } }, 'lead_assigned'),
    ).toBe(true);
    expect(NotificationRules.emailEnabled({ email: { system: true } }, 'lead_assigned')).toBe(
      false,
    );
  });
});

describe('NotificationsService.notify', () => {
  function build() {
    const { service: prisma, client } = createPrismaMock();
    const email = { send: jest.fn().mockResolvedValue({ jobId: 'job' }) };
    const logger = createLoggerMock();
    const service = new NotificationsService(
      prisma,
      email as unknown as EmailService,
      logger as never,
    );
    return { service, client, email, logger };
  }

  const input = {
    organizationId: ORG,
    userId: 'u2',
    type: 'lead_assigned' as const,
    title: 'Lead assigned to you: Big deal',
    body: 'Owen assigned you a lead.',
    link: '/leads/l1',
    data: { leadId: 'l1' },
  };

  function user(preferences: unknown) {
    return { id: 'u2', email: 'u2@test.local', preferences };
  }

  function createdRow() {
    return {
      id: 'n1',
      organizationId: ORG,
      userId: 'u2',
      type: 'lead_assigned',
      title: input.title,
      body: input.body,
      link: input.link,
      data: input.data,
      readAt: null,
      createdAt: now,
    };
  }

  it('writes the in-app row synchronously by default and does not email', async () => {
    const { service, client, email } = build();
    client.user.findFirst.mockResolvedValue(user({}));
    client.notification.create.mockResolvedValue(createdRow());
    const result = await service.notify(input);
    expect(client.notification.create).toHaveBeenCalledWith({
      data: {
        organizationId: ORG,
        userId: 'u2',
        type: 'lead_assigned',
        title: input.title,
        body: input.body,
        link: input.link,
        data: input.data,
      },
    });
    expect(email.send).not.toHaveBeenCalled();
    expect(result?.id).toBe('n1');
  });

  it('skips the in-app row when the user disabled that type', async () => {
    const { service, client } = build();
    client.user.findFirst.mockResolvedValue(
      user({ notifications: { inApp: { lead_assigned: false } } }),
    );
    const result = await service.notify(input);
    expect(client.notification.create).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('enqueues a generic email only when the user explicitly enabled email for the type', async () => {
    const { service, client, email } = build();
    client.user.findFirst.mockResolvedValue(
      user({ notifications: { email: { lead_assigned: true } } }),
    );
    client.notification.create.mockResolvedValue(createdRow());
    await service.notify(input);
    expect(email.send).toHaveBeenCalledWith(
      'generic',
      'u2@test.local',
      expect.objectContaining({
        subject: input.title,
        body: input.body,
        ctaLabel: 'Open',
        ctaUrl: '/leads/l1',
      }),
      expect.objectContaining({ idempotencyKey: 'notif-email-n1', organizationId: ORG }),
    );
  });

  it('ignores unknown or inactive recipients and never throws', async () => {
    const { service, client, logger } = build();
    client.user.findFirst.mockResolvedValue(null);
    await expect(service.notify(input)).resolves.toBeNull();
    client.user.findFirst.mockRejectedValue(new Error('db down'));
    await expect(service.notify(input)).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('NotificationsService.replacePreferences', () => {
  it('stores the notifications key without clobbering theme and locale', async () => {
    const { service: prisma, client } = createPrismaMock();
    const service = new NotificationsService(
      prisma,
      { send: jest.fn() } as unknown as EmailService,
      createLoggerMock() as never,
    );
    client.user.findUnique.mockResolvedValue({ preferences: { theme: 'dark', locale: 'he' } });
    client.user.update.mockResolvedValue({});
    const prefs = { inApp: { lead_assigned: false }, email: { conversation_assigned: true } };
    await service.replacePreferences({ userId: 'u1', email: 'x', sessionId: 's', emailVerified: true }, prefs);
    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { preferences: { theme: 'dark', locale: 'he', notifications: prefs } },
    });
  });
});
