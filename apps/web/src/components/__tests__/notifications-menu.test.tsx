import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Permission, type Notification } from '@hilatech/contracts';
import { paginated, renderWithProviders, seedSession, TEST_USER } from '@/test/render';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push, prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

const list = vi.fn();
const unreadCount = vi.fn();
const markRead = vi.fn();
const markAllRead = vi.fn();
vi.mock('@/lib/api/notifications', () => ({
  notificationsApi: {
    list: (...args: unknown[]) => list(...args),
    unreadCount: (...args: unknown[]) => unreadCount(...args),
    markRead: (...args: unknown[]) => markRead(...args),
    markAllRead: (...args: unknown[]) => markAllRead(...args),
    preferences: vi.fn(),
    updatePreferences: vi.fn(),
  },
}));

import { NotificationsMenu } from '@/components/shell/notifications-menu';

function notification(id: string, overrides: Partial<Notification> = {}): Notification {
  return {
    id,
    organizationId: null,
    userId: TEST_USER.id,
    type: 'lead_assigned',
    title: `Lead ${id} assigned to you`,
    body: null,
    link: `/leads/${id}`,
    data: {},
    readAt: null,
    createdAt: '2026-11-09T08:00:00.000Z',
    ...overrides,
  };
}

const N1 = notification('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const N2 = notification('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { link: null, body: 'Details' });

describe('NotificationsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedSession([Permission.NOTIFICATIONS_READ]);
    list.mockResolvedValue(paginated([N1, N2], 2));
    unreadCount.mockResolvedValue({ unread: 2 });
    // The server reflects each change on the next refetch.
    markRead.mockImplementation(() => {
      unreadCount.mockResolvedValue({ unread: 1 });
      list.mockResolvedValue(paginated([N2], 1));
      return Promise.resolve(undefined);
    });
    markAllRead.mockImplementation(() => {
      unreadCount.mockResolvedValue({ unread: 0 });
      list.mockResolvedValue(paginated([], 0));
      return Promise.resolve({ updated: 2 });
    });
  });

  it('shows the unread count from /notifications/unread-count', async () => {
    renderWithProviders(<NotificationsMenu />);
    expect(
      await screen.findByRole('button', { name: 'Notifications, 2 unread' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('2');
    expect(unreadCount).toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({ unread: true, page: 1, pageSize: 20 });
  });

  it('marks a notification read on click, drops it from the list and follows its link', async () => {
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    const item = await screen.findByRole('button', { name: /Lead aaaaaaaa/ });
    await userEvent.click(item);

    await waitFor(() => expect(markRead).toHaveBeenCalledWith(N1.id));
    expect(push).toHaveBeenCalledWith(`/leads/${N1.id}`);
    // Optimistic: the item is gone and the badge drops before the refetch.
    expect(screen.queryByRole('button', { name: /Lead aaaaaaaa/ })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument(),
    );
  });

  it('marks everything read', async () => {
    renderWithProviders(<NotificationsMenu />);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(markAllRead).toHaveBeenCalled());
    expect(await screen.findByText('You’re all caught up.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument(),
    );
  });

  it('renders nothing without the notifications permission', () => {
    seedSession([]);
    const { container } = renderWithProviders(<NotificationsMenu />);
    expect(container).toBeEmptyDOMElement();
  });
});
