'use client';

import { Languages } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@hilatech/ui';
import { LOCALES, LOCALE_META, LOCALE_PENDING_KEY, type Locale } from '@/i18n/config';
import { useI18n, useT } from '@/i18n/provider';
import { usersApi } from '@/lib/api';
import { usePreferences } from '@/stores/preferences';
import { useSession } from '@/stores/session';

/**
 * Switches the UI language. Updates the cookie/<html> immediately (via the I18nProvider) and, when signed in,
 * persists the choice to the profile preference. Signed out, it leaves a flag so the choice is pushed on sign-in.
 */
export function useChangeLocale() {
  const { locale, setLocale } = useI18n();
  return (next: Locale) => {
    if (next === locale) return;
    setLocale(next);
    usePreferences.getState().setPreferences({ locale: next });
    if (useSession.getState().status === 'authenticated') {
      void usersApi.patchPreferences({ locale: next }).catch(() => undefined);
    } else {
      try {
        window.sessionStorage.setItem(LOCALE_PENDING_KEY, '1');
      } catch {
        // storage unavailable: the cookie still carries the choice on this device
      }
    }
  };
}

/** Radio items for the user menu / any DropdownMenuContent. */
export function LocaleRadioItems() {
  const { locale } = useI18n();
  const change = useChangeLocale();
  return (
    <DropdownMenuRadioGroup value={locale} onValueChange={(v) => change(v as Locale)}>
      {LOCALES.map((code) => (
        <DropdownMenuRadioItem key={code} value={code} lang={code} dir={LOCALE_META[code].dir}>
          {LOCALE_META[code].nativeName}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** Stand-alone switcher for the login/register/landing pages. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useT();
  const { locale } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={className}
          aria-label={t('shell.language')}
          leadingIcon={<Languages aria-hidden />}
        >
          <span lang={locale}>{LOCALE_META[locale].nativeName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        <LocaleRadioItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
