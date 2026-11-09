'use client';

import * as React from 'react';
import { ErrorState } from '@hilatech/ui';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <ErrorState
        className="w-full max-w-md"
        title="Something broke on this page"
        message="An unexpected error occurred while rendering. Reload the page or try again."
        requestId={error.digest}
        onRetry={reset}
        retryLabel="Try again"
      />
    </div>
  );
}
