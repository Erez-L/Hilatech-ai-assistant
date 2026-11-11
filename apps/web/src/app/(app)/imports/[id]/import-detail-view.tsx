'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import { Badge, Card, CardContent, PageHeader, Skeleton } from '@hilatech/ui';
import { useImportJob } from '@/hooks/sales';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { ImportResult } from '@/components/data-exchange/import-result';
import { IMPORT_ENTITY_LABELS, isTerminalImport } from '@/lib/imports';
import { useFormat, useT } from '@/i18n/provider';

export function ImportDetailView({ id }: { id: string }) {
  const t = useT();
  const fmt = useFormat();
  const job = useImportJob(id, { poll: true });
  return (
    <PermissionGate anyOf={[Permission.DATA_IMPORT]}>
      <QueryState
        query={job}
        loading={<Skeleton className="h-64 w-full rounded-lg" />}
        errorTitle={t('imports.thisImportCouldnTBeLoaded')}
      >
        {(data) => (
          <div className="flex flex-col gap-6">
            <PageHeader
              breadcrumb={
                <Link href="/imports" className="inline-flex items-center gap-1 hover:text-fg">
                  <ArrowLeft className="size-3.5" aria-hidden />
                  {t('imports.imports')}
                </Link>
              }
              title={<span dir="auto">{data.fileName}</span>}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{t(IMPORT_ENTITY_LABELS[data.entity])}</Badge>
                  <Badge variant="outline">{t('imports.rowsCount', { count: data.totalRows })}</Badge>
                  <time dateTime={data.createdAt}>{fmt.dateTime(new Date(data.createdAt))}</time>
                </span>
              }
            />
            <Card>
              <CardContent className="py-5">
                {isTerminalImport(data.status) ? (
                  <ImportResult job={data} />
                ) : (
                  <p className="text-sm text-fg-muted">
                    {t('imports.notFinished', { processed: data.progress.processed, total: data.progress.total })}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </QueryState>
    </PermissionGate>
  );
}
