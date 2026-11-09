import type { Notification, NotificationPreferences, UnreadCount } from '@hilatech/contracts';
import { api } from './client';

export interface ListNotificationsParams {
  unread?: boolean;
  page?: number;
  pageSize?: number;
}

export const notificationsApi = {
  list: (params: ListNotificationsParams = {}) =>
    api.list<Notification>('/notifications', {
      unread: params.unread ? true : undefined,
      page: params.page,
      pageSize: params.pageSize,
    }),
  unreadCount: () => api.get<UnreadCount>('/notifications/unread-count'),
  markRead: (id: string) =>
    api.post<Notification | void>(`/notifications/${encodeURIComponent(id)}/read`),
  markAllRead: () => api.post<{ updated: number }>('/notifications/read-all'),
  preferences: () => api.get<NotificationPreferences>('/notifications/preferences'),
  updatePreferences: (body: NotificationPreferences) =>
    api.put<NotificationPreferences>('/notifications/preferences', body),
};
