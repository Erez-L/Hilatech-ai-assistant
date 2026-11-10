'use client';

import Link from 'next/link';
import { Wallet } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import { Alert, Button } from '@hilatech/ui';
import { useCan } from '@/hooks/use-can';
import { describeBudgetExceeded, readBudgetDetails } from '@/lib/billing';
import { useT, useFormat } from '@/i18n/provider';

/**
 * Shown when the API refuses an AI request with 402 BUDGET_EXCEEDED (monthly AI budget hard stop).
 * Explains what happened and links to the billing page, where the budget can be raised or the hard stop
 * turned off (members without the billing permission are told to ask an admin).
 */
export function BudgetExceeded({
  details,
  onDismiss,
}: {
  /** `error.details` from the 402 response (scope, reason, used, budget). */
  details?: unknown;
  onDismiss?: () => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const canManage = useCan(Permission.ORG_BILLING_MANAGE);
  return (
    <Alert tone="danger" title={t('ai.monthlyAiBudgetReached')} data-testid="budget-exceeded">
      <div className="flex flex-col gap-3">
        <p>
          {t('ai.nothingWasSentToThe', {
            describeBudgetExceeded: describeBudgetExceeded(readBudgetDetails(details), t, fmt),
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <Button asChild size="sm" leadingIcon={<Wallet aria-hidden />}>
              <Link href="/settings/billing">{t('ai.reviewBudgetInBilling')}</Link>
            </Button>
          ) : (
            <span className="text-xs">{t('ai.askAnOrganizationAdminWith')}</span>
          )}
          {onDismiss ? (
            <Button size="sm" variant="secondary" onClick={onDismiss}>
              {t('common.dismiss')}
            </Button>
          ) : null}
        </div>
      </div>
    </Alert>
  );
}
