'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
} from '@hilatech/ui';
import { useTheme, type Theme } from '@/lib/theme';
import { usePreferences } from '@/stores/preferences';
import { useSession } from '@/stores/session';
import { usersApi } from '@/lib/api';
import { useT } from '@/i18n/provider';

export function useThemePreference() {
  const { theme, setTheme } = useTheme();
  const setPreferences = usePreferences((s) => s.setPreferences);

  const update = (next: Theme) => {
    setTheme(next);
    setPreferences({ theme: next });
    // Persist to the account when signed in; failures are silent (the local preference still applies).
    if (useSession.getState().status === 'authenticated') {
      void usersApi.patchPreferences({ theme: next }).catch(() => undefined);
    }
  };

  return { theme, setTheme: update };
}

export function ThemeToggle() {
  const t = useT();
  const { theme, setTheme } = useThemePreference();
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t('shell.changeTheme')}>
          <Icon aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">{t('common.light')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('common.dark')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t('common.system')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
