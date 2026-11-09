import { Suspense } from 'react';
import Link from 'next/link';
import { Wordmark } from '@hilatech/ui';
import { AuthGate } from '@/components/auth/auth-gate';
import { FullPageLoader } from '@/components/common/full-page-loader';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <AuthGate requireOrganization={false}>
        <div className="flex min-h-dvh flex-col bg-bg">
          <header className="flex h-16 items-center px-6 sm:px-10">
            <Link href="/" className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Wordmark />
            </Link>
          </header>
          <main className="flex flex-1 items-start justify-center px-4 pt-4 pb-16 sm:pt-8">
            <div className="w-full max-w-xl">{children}</div>
          </main>
        </div>
      </AuthGate>
    </Suspense>
  );
}
