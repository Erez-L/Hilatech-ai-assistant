'use client';

import type { DealStatus, StageKind } from '@hilatech/contracts';
import { Badge, StatusBadge, type StatusBadgeProps } from '@hilatech/ui';
import { DEAL_STATUS_LABELS, DEAL_STATUS_TONES, STAGE_KIND_LABELS } from '@/lib/deals';
import { useT } from '@/i18n/provider';

export function DealStatusBadge({
  status,
  ...props
}: { status: DealStatus } & Omit<StatusBadgeProps, 'status' | 'tone' | 'label'>) {
  const t = useT();
  return (
    <StatusBadge
      status={status}
      tone={DEAL_STATUS_TONES[status]}
      label={t(DEAL_STATUS_LABELS[status])}
      {...props}
    />
  );
}

/** Won / lost marker for stage headers (open stages need none). */
export function StageKindBadge({ kind }: { kind: StageKind }) {
  const t = useT();
  if (kind === 'open') return null;
  return <Badge variant={kind === 'won' ? 'success' : 'danger'}>{t(STAGE_KIND_LABELS[kind])}</Badge>;
}
