import { Suspense } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { AppShell } from '@/components/shell/app-shell';
import { FullPageLoader } from '@/components/common/full-page-loader';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <AuthGate>
        <AppShell>{children}</AppShell>
      </AuthGate>
    </Suspense>
  );
}
