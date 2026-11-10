'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, TooltipProvider } from '@hilatech/ui';
import { isApiError } from '@/lib/api/client';
import { ThemeProvider } from '@/lib/theme';
import { I18nProvider } from '@/i18n/provider';
import type { Locale } from '@/i18n/config';
import { LocaleSync } from '@/components/shell/locale-sync';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Never retry auth/permission/validation failures; retry transient errors once.
          if (
            isApiError(error) &&
            (error.status === 401 ||
              error.status === 403 ||
              error.status === 404 ||
              error.status === 400)
          ) {
            return false;
          }
          return failureCount < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const [queryClient] = React.useState(makeQueryClient);
  const router = useRouter();
  // After a client-side language switch, re-render the server layout so <html lang dir> and metadata follow.
  const onLocaleChange = React.useCallback(() => router.refresh(), [router]);
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={locale} onLocaleChange={onLocaleChange}>
        <ThemeProvider>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
          <Toaster />
          <LocaleSync />
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
