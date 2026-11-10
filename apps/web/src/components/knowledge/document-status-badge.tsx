import { Loader2 } from 'lucide-react';
import type { DocumentStatus } from '@hilatech/contracts';
import { StatusBadge } from '@hilatech/ui';
import { DOCUMENT_STATUS_LABELS, DOCUMENT_STATUS_TONES } from '@/lib/knowledge';
import { useT } from '@/i18n/provider';

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge
        status={status}
        tone={DOCUMENT_STATUS_TONES[status]}
        label={t(DOCUMENT_STATUS_LABELS[status])}
      />
      {status === 'processing' ? (
        <Loader2 className="size-3.5 animate-spin text-fg-muted" aria-hidden />
      ) : null}
    </span>
  );
}
