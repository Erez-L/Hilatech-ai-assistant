'use client';

import * as React from 'react';
import { ErrorState } from '@hilatech/ui';
import { useT } from '@/i18n/provider';

export default function AppError({
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
    <ErrorState
      title={t('app.thisPageRanIntoA')}
      message={t('app.somethingUnexpectedHappenedWhileRendering')}
      requestId={error.digest}
      onRetry={reset}
    />
  );
}
