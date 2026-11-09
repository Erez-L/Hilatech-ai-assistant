import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_PREFERENCES, type UserPreferences } from '@/lib/api/types';
import { STORAGE_KEYS } from '@/lib/env';

interface PreferencesState extends UserPreferences {
  setPreferences: (patch: Partial<UserPreferences>) => void;
  reset: () => void;
}

/**
 * User preferences mirror. The server stores them via PUT /users/me/preferences, but the current
 * contracts expose no read endpoint, so the last known values are kept locally as well.
 */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      setPreferences: (patch) => set((state) => ({ ...state, ...patch })),
      reset: () => set({ ...DEFAULT_PREFERENCES }),
    }),
    {
      name: STORAGE_KEYS.preferences,
      partialize: (s) => ({ theme: s.theme, locale: s.locale, notifications: s.notifications }),
    },
  ),
);
