import Link from 'next/link';
import { Button, Wordmark } from '@hilatech/ui';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <Wordmark />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-fg-muted">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">This page doesn’t exist</h1>
        <p className="max-w-sm text-sm text-fg-muted">
          The link may be out of date, or the page may have moved. Head back to the dashboard.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </div>
  );
}
