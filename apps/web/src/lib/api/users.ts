import type { AuthUser } from '@hilatech/contracts';
import { api } from './client';
import type { UpdateProfileRequest, UserPreferences } from './types';

export const usersApi = {
  me: () => api.get<AuthUser>('/users/me', { organization: false }),
  update: (
    body: Omit<Partial<UpdateProfileRequest>, 'avatarUrl'> & { avatarUrl?: string | null },
  ) => api.patch<AuthUser>('/users/me', body, { organization: false }),
  preferences: () =>
    api.get<Pick<UserPreferences, 'theme' | 'locale'>>('/users/me/preferences', {
      organization: false,
    }),
  /**
   * Merges a partial change into the server-side preferences (GET + PUT). The server stores per-type
   * notification maps, which the web mirror does not model, so they are passed through untouched.
   */
  patchPreferences: async (patch: Partial<UserPreferences>) => {
    const saved = await api.get<Record<string, unknown>>('/users/me/preferences', {
      organization: false,
    });
    return api.put<Record<string, unknown>>(
      '/users/me/preferences',
      { ...saved, ...patch },
      { organization: false },
    );
  },
  updatePreferences: (body: UserPreferences) =>
    api.put<UserPreferences>('/users/me/preferences', body, { organization: false }),
};
