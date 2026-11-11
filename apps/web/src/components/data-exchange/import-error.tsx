'use client';

import Link from 'next/link';
import { Alert } from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useT } from '@/i18n/provider';

/**
 * Failure of an import step. Entitlement (402) and permission (403) problems get their own explanation;
 * everything else shows the server's message.
 */
export function ImportError({ error }: { error: unknown }) {
  const t = useT();
  if (isApiError(error) && (error.status === 402 || error.code === 'ENTITLEMENT_EXCEEDED')) {
    return (
      <Alert
        tone="warning"
        title={t('imports.planLimitReached')}
        data-testid="import-entitlement-error"
      >
        <p>{getErrorMessage(error)}</p>
        <p className="mt-1">
          <Link href="/settings/billing" className="font-medium underline">
            {t('imports.reviewYourPlan')}
          </Link>
        </p>
      </Alert>
    );
  }
  if (isApiError(error) && error.status === 403) {
    return (
      <Alert tone="danger" title={t('imports.notAllowed')}>
        {t('imports.notAllowedHint')}
      </Alert>
    );
  }
  if (isApiError(error) && error.status === 413) {
    return (
      <Alert tone="danger" title={t('imports.fileTooLarge')}>
        {getErrorMessage(error)}
      </Alert>
    );
  }
  return (
    <Alert tone="danger" title={t('imports.somethingWentWrong')}>
      {getErrorMessage(error)}
    </Alert>
  );
}
