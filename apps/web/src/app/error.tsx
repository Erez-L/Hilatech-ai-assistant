'use client';

import * as React from 'react';
import { ErrorState } from '@hilatech/ui';
import { useT } from '@/i18n/provider';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  React.useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <ErrorState
        className="w-full max-w-md"
        title={t('app.somethingBrokeOnThisPage')}
        message={t('app.anUnexpectedErrorOccurredWhile')}
        requestId={error.digest}
        onRetry={reset}
        retryLabel={t('common.tryAgain')}
      />
    </div>
  );
}
