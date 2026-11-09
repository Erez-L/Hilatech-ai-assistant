import type { AuthUser } from '@hilatech/contracts';
import { api } from './client';
import type { UpdateProfileRequest, UserPreferences } from './types';

export const usersApi = {
  me: () => api.get<AuthUser>('/users/me', { organization: false }),
  update: (body: Omit<Partial<UpdateProfileRequest>, 'avatarUrl'> & { avatarUrl?: string | null }) =>
    api.patch<AuthUser>('/users/me', body, { organization: false }),
  updatePreferences: (body: UserPreferences) =>
    api.put<UserPreferences>('/users/me/preferences', body, { organization: false }),
};
