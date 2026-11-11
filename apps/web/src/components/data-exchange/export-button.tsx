'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import { Button, toast } from '@hilatech/ui';
import { exportsApi, getErrorMessage, type ExportEntity } from '@/lib/api';
import type { QueryParams } from '@/lib/api/client';
import { saveBlob } from '@/lib/analytics';
import { useCan } from '@/hooks/use-can';
import { useT } from '@/i18n/provider';

/**
 * Downloads the CSV export of a list with the filters currently applied (GET /export/<entity>).
 * Hidden without `data:export`. Server errors (402 plan limit, 403) surface as a toast.
 */
export function ExportButton({
  entity,
  filters,
  label,
  className,
}: {
  entity: ExportEntity;
  filters?: QueryParams;
  label: string;
  className?: string;
}) {
  const t = useT();
  const canExport = useCan(Permission.DATA_EXPORT);
  const [busy, setBusy] = React.useState(false);
  if (!canExport) return null;

  const run = async () => {
    setBusy(true);
    try {
      const file = await exportsApi.download(entity, filters ?? {});
      saveBlob(file.blob, file.filename);
      toast.success(t('imports.exportDownloaded', { filename: file.filename }));
    } catch (error) {
      toast.error(getErrorMessage(error, t('imports.exportFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="secondary"
      className={className}
      leadingIcon={<Download aria-hidden />}
      loading={busy}
      aria-label={t('imports.exportAsCsv', { label })}
      onClick={() => void run()}
    >
      {t('imports.export')}
    </Button>
  );
}
