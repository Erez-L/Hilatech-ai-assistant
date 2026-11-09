import Link from 'next/link';
import { Wordmark } from '@hilatech/ui';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-16 items-center px-6 sm:px-10">
        <Link href="/" className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <Wordmark />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-6 py-6 text-center text-xs text-fg-subtle">
        © {new Date().getFullYear()} HilaTech Dev. All rights reserved.
      </footer>
    </div>
  );
}
