'use client';

import * as React from 'react';
import { Download } from 'lucide-react';
import type { ImportJob } from '@hilatech/contracts';
import {
  Alert,
  Button,
  EmptyState,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, importsApi } from '@/lib/api';
import { saveBlob } from '@/lib/analytics';
import { useImportReport } from '@/hooks/sales';
import { QueryState } from '@/components/common/query-state';
import { ImportStatusBadge } from './import-status';
import { enumLabel } from '@/i18n/enums';
import { useT } from '@/i18n/provider';

/** Final counters, the skipped/failed rows with reasons and the CSV report download. */
export function ImportResult({ job }: { job: ImportJob }) {
  const t = useT();
  const report = useImportReport(job.id, job.status === 'completed' || job.status === 'failed');
  const [busy, setBusy] = React.useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const file = await importsApi.reportCsv(job.id);
      saveBlob(file.blob, file.filename);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="import-result">
      <div className="flex items-center gap-3">
        <ImportStatusBadge status={job.status} />
        <span className="text-sm text-fg-muted" dir="auto">
          {job.fileName}
        </span>
      </div>
      {job.error ? (
        <Alert tone="danger" title={t('imports.importFailed')}>
          {job.error}
        </Alert>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('imports.created')} value={job.result.created} data-testid="import-created" />
        <StatCard label={t('imports.updated')} value={job.result.updated} data-testid="import-updated" />
        <StatCard label={t('imports.skipped')} value={job.result.skipped} data-testid="import-skipped" />
        <StatCard label={t('imports.failedRows')} value={job.result.failed} data-testid="import-failed" />
      </div>

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t('imports.skippedAndFailedRows')}</h3>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Download aria-hidden />}
          loading={busy}
          onClick={() => void download()}
        >
          {t('imports.downloadReport')}
        </Button>
      </div>
      <QueryState
        query={report}
        compact
        loading={<p className="text-sm text-fg-muted">{t('imports.loadingReport')}</p>}
        isEmpty={(r) => r.rows.length === 0}
        empty={<EmptyState compact title={t('imports.nothingSkipped')} description={t('imports.nothingSkippedHint')} />}
      >
        {(r) => (
          <div className="flex flex-col gap-2">
            <div className="max-h-64 overflow-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">{t('imports.row')}</TableHead>
                    <TableHead className="w-28">{t('common.status')}</TableHead>
                    <TableHead>{t('common.reason')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.rows.map((row) => (
                    <TableRow key={`${row.row}-${row.status}`}>
                      <TableCell className="tabular">{row.row}</TableCell>
                      <TableCell>{enumLabel(t, 'imports.rowStatus', row.status)}</TableCell>
                      <TableCell dir="auto">{row.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {r.truncated ? <p className="text-xs text-fg-muted">{t('imports.reportTruncated')}</p> : null}
          </div>
        )}
      </QueryState>
    </div>
  );
}
