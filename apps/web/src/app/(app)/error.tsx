'use client';

import * as React from 'react';
import { ErrorState } from '@hilatech/ui';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState
      title="This page ran into a problem"
      message="Something unexpected happened while rendering. Your data is safe — try again."
      requestId={error.digest}
      onRetry={reset}
    />
  );
}
