import type { Notification } from '@hilatech/contracts';
import { api } from './client';

export const notificationsApi = {
  list: (unread?: boolean) => api.list<Notification>('/notifications', { unread: unread ? true : undefined }),
  markRead: (id: string) => api.post<void>(`/notifications/${encodeURIComponent(id)}/read`),
  markAllRead: () => api.post<void>('/notifications/read-all'),
};
