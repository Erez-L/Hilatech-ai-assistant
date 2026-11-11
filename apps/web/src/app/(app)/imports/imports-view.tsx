'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileUp, Upload } from 'lucide-react';
import {
  ImportStatus as ImportStatusEnum,
  Permission,
  type ImportEntity,
  type ImportStatus,
} from '@hilatech/contracts';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Label,
  NativeSelect,
  PageHeader,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useImports } from '@/hooks/sales';
import { PermissionGate } from '@/components/common/permission-gate';
import { ImportStatusBadge } from '@/components/data-exchange/import-status';
import { ImportWizardDialog } from '@/components/data-exchange/import-wizard';
import { IMPORT_ENTITIES, IMPORT_ENTITY_LABELS } from '@/lib/imports';
import { enumLabel } from '@/i18n/enums';
import { useFormat, useT } from '@/i18n/provider';

const PAGE_SIZE = 20;

export function ImportsView() {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const [page, setPage] = React.useState(1);
  const [entity, setEntity] = React.useState<ImportEntity | ''>('');
  const [status, setStatus] = React.useState<ImportStatus | ''>('');
  const [open, setOpen] = React.useState(false);
  const imports = useImports({
    page,
    pageSize: PAGE_SIZE,
    entity: entity || undefined,
    status: status || undefined,
  });

  return (
    <PermissionGate anyOf={[Permission.DATA_IMPORT]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('imports.imports')}
          description={t('imports.importsDescription')}
          actions={
            <Button leadingIcon={<Upload aria-hidden />} onClick={() => setOpen(true)}>
              {t('imports.newImport')}
            </Button>
          }
        />
        <Card>
          <CardContent className="grid gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="imports-entity">{t('imports.dataType')}</Label>
              <NativeSelect
                id="imports-entity"
                value={entity}
                onChange={(e) => {
                  setEntity(e.target.value as ImportEntity | '');
                  setPage(1);
                }}
              >
                <option value="">{t('imports.allDataTypes')}</option>
                {IMPORT_ENTITIES.map((e) => (
                  <option key={e} value={e}>
                    {t(IMPORT_ENTITY_LABELS[e])}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="imports-status">{t('common.status')}</Label>
              <NativeSelect
                id="imports-status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as ImportStatus | '');
                  setPage(1);
                }}
              >
                <option value="">{t('common.allStatuses')}</option>
                {ImportStatusEnum.options.map((s) => (
                  <option key={s} value={s}>
                    {enumLabel(t, 'imports.status', s)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('imports.file')}</TableHead>
                  <TableHead>{t('imports.dataType')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="text-end">{t('imports.created')}</TableHead>
                  <TableHead className="text-end">{t('imports.updated')}</TableHead>
                  <TableHead className="text-end">{t('imports.skipped')}</TableHead>
                  <TableHead className="text-end">{t('imports.failedRows')}</TableHead>
                  <TableHead>{t('common.started')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.isPending ? (
                  <TableSkeletonRows columns={8} rows={6} />
                ) : imports.isError ? (
                  <TableEmptyRow colSpan={8}>
                    <div className="flex flex-col items-center gap-2">
                      <span>{getErrorMessage(imports.error)}</span>
                      <Button variant="secondary" size="sm" onClick={() => void imports.refetch()}>
                        {t('common.tryAgain')}
                      </Button>
                    </div>
                  </TableEmptyRow>
                ) : imports.data.data.length === 0 ? (
                  <TableEmptyRow colSpan={8} className="py-4">
                    <EmptyState
                      compact
                      icon={<FileUp />}
                      title={t('imports.noImportsYet')}
                      description={t('imports.noImportsYetHint')}
                      action={
                        <Button
                          size="sm"
                          leadingIcon={<Upload aria-hidden />}
                          onClick={() => setOpen(true)}
                        >
                          {t('imports.newImport')}
                        </Button>
                      }
                    />
                  </TableEmptyRow>
                ) : (
                  imports.data.data.map((job) => (
                    <TableRow
                      key={job.id}
                      className="cursor-pointer"
                      data-testid="import-row"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a,button')) return;
                        router.push(`/imports/${job.id}`);
                      }}
                    >
                      <TableCell>
                        <Link
                          href={`/imports/${job.id}`}
                          dir="auto"
                          className="font-medium hover:underline"
                        >
                          {job.fileName}
                        </Link>
                      </TableCell>
                      <TableCell>{t(IMPORT_ENTITY_LABELS[job.entity])}</TableCell>
                      <TableCell>
                        <ImportStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="text-end tabular">{job.result.created}</TableCell>
                      <TableCell className="text-end tabular">{job.result.updated}</TableCell>
                      <TableCell className="text-end tabular">{job.result.skipped}</TableCell>
                      <TableCell className="text-end tabular">{job.result.failed}</TableCell>
                      <TableCell className="whitespace-nowrap text-fg-muted tabular">
                        <time
                          dateTime={job.createdAt}
                          title={fmt.dateTime(new Date(job.createdAt), 'long')}
                        >
                          {fmt.relative(new Date(job.createdAt))}
                        </time>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {imports.data && imports.data.meta.total > PAGE_SIZE ? (
              <div className="border-t border-border px-5 py-3">
                <Pagination
                  page={imports.data.meta.page}
                  pageSize={imports.data.meta.pageSize}
                  total={imports.data.meta.total}
                  onPageChange={setPage}
                  itemLabel={t('imports.importsLower')}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
        <ImportWizardDialog open={open} onOpenChange={setOpen} />
      </div>
    </PermissionGate>
  );
}
