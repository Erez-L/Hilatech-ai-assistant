'use client';

import * as React from 'react';
import { LOCALE_PENDING_KEY, isLocale } from '@/i18n/config';
import { useI18n } from '@/i18n/provider';
import { usersApi } from '@/lib/api';
import { usePreferences } from '@/stores/preferences';
import { useSession } from '@/stores/session';

/**
 * Reconciles the saved profile locale with this device once per sign-in:
 *  - the user picked a language while signed out (or just registered) -> push it to the profile;
 *  - otherwise the profile preference wins and is adopted (cookie + <html dir/lang> + preference mirror).
 */
export function LocaleSync() {
  const { locale, setLocale } = useI18n();
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.id ?? null);
  const handled = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (status !== 'authenticated' || !userId || handled.current === userId) return;
    handled.current = userId;
    let pending = false;
    try {
      pending = window.sessionStorage.getItem(LOCALE_PENDING_KEY) === '1';
      window.sessionStorage.removeItem(LOCALE_PENDING_KEY);
    } catch {
      // ignore
    }
    void (async () => {
      try {
        const saved = await usersApi.preferences();
        if (pending) {
          if (saved.locale !== locale) await usersApi.patchPreferences({ locale });
          usePreferences.getState().setPreferences({ locale });
        } else if (isLocale(saved.locale)) {
          usePreferences.getState().setPreferences({ locale: saved.locale });
          if (saved.locale !== locale) setLocale(saved.locale);
        }
      } catch {
        // Offline or older API: the cookie keeps the device language.
      }
    })();
  }, [status, userId, locale, setLocale]);

  return null;
}
