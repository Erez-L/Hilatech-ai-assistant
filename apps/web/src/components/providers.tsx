'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, TooltipProvider } from '@hilatech/ui';
import { isApiError } from '@/lib/api/client';
import { ThemeProvider } from '@/lib/theme';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Never retry auth/permission/validation failures; retry transient errors once.
          if (isApiError(error) && (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 400)) {
            return false;
          }
          return failureCount < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
