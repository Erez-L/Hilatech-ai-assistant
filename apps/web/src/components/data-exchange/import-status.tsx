'use client';

import type { ImportStatus } from '@hilatech/contracts';
import { StatusBadge, type StatusTone } from '@hilatech/ui';
import { msg, type Msg } from '@/i18n/msg';
import { useT } from '@/i18n/provider';

const LABELS: Record<ImportStatus, Msg> = {
  uploaded: msg('imports.status.uploaded'),
  validated: msg('imports.status.validated'),
  queued: msg('imports.status.queued'),
  running: msg('imports.status.running'),
  completed: msg('imports.status.completed'),
  failed: msg('imports.status.failed'),
  cancelled: msg('imports.status.cancelled'),
};
const TONES: Record<ImportStatus, StatusTone> = {
  uploaded: 'neutral',
  validated: 'info',
  queued: 'warning',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const t = useT();
  return <StatusBadge status={status} tone={TONES[status]} label={t(LABELS[status])} />;
}
