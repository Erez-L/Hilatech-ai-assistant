'use client';

import { Badge, type BadgeProps } from '@hilatech/ui';
import { useT } from '@/i18n/provider';
import type { MessageKey } from '@/i18n/messages';

const RUN_VARIANT: Record<string, BadgeProps['variant']> = {
  queued: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'warning',
};
const RESULT_VARIANT: Record<string, BadgeProps['variant']> = {
  passed: 'success',
  failed: 'danger',
  error: 'warning',
};

export function RunStatusBadge({ status }: { status: string }) {
  const t = useT();
  return (
    <Badge variant={RUN_VARIANT[status] ?? 'neutral'} dot>
      {status in RUN_VARIANT ? t(`evaluations.status.${status}` as MessageKey) : status}
    </Badge>
  );
}

export function ResultStatusBadge({ status }: { status: string }) {
  const t = useT();
  return (
    <Badge variant={RESULT_VARIANT[status] ?? 'neutral'} dot>
      {status in RESULT_VARIANT ? t(`evaluations.result.${status}` as MessageKey) : status}
    </Badge>
  );
}
