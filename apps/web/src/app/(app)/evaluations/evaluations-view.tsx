'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  LoadingBlock,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@hilatech/ui';
import { evaluationsApi, getErrorMessage, keys } from '@/lib/api';
import { useActiveOrganizationId } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { PermissionGate } from '@/components/common/permission-gate';
import { RunStatusBadge } from '@/components/evaluations/status-badges';
import { useT } from '@/i18n/provider';

export function EvaluationsView() {
  const t = useT();
  const router = useRouter();
  const orgId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  const canManage = useCan(Permission.AGENTS_MANAGE);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');

  const datasets = useQuery({
    queryKey: keys.evaluations(orgId, 'datasets'),
    queryFn: evaluationsApi.datasets,
    enabled: !!orgId,
  });
  const create = useMutation({
    mutationFn: () =>
      evaluationsApi.createDataset({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: (dataset) => {
      void queryClient.invalidateQueries({ queryKey: keys.evaluations(orgId) });
      setOpen(false);
      setName('');
      setDescription('');
      router.push(`/evaluations/${dataset.id}`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const rows = datasets.data ?? [];
  const newButton = canManage ? (
    <Button leadingIcon={<Plus aria-hidden />} onClick={() => setOpen(true)}>
      {t('evaluations.newDataset')}
    </Button>
  ) : null;

  return (
    <PermissionGate anyOf={[Permission.AGENTS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('evaluations.evaluations')}
          description={t('evaluations.description')}
          actions={newButton}
        />
        {datasets.isError ? (
          <Alert tone="danger">{t('evaluations.couldNotLoad')}</Alert>
        ) : datasets.isLoading ? (
          <LoadingBlock />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<FlaskConical aria-hidden />}
            title={t('evaluations.noDatasets')}
            description={t('evaluations.noDatasetsHint')}
            action={newButton}
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('evaluations.datasetName')}</TableHead>
                    <TableHead>{t('evaluations.cases')}</TableHead>
                    <TableHead>{t('evaluations.lastRun')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Link href={`/evaluations/${d.id}`} className="font-medium hover:underline">
                          {d.name}
                        </Link>
                        {d.description ? (
                          <p className="line-clamp-1 text-sm text-fg-muted">{d.description}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>{t('evaluations.caseCount', { count: d.caseCount })}</TableCell>
                      <TableCell>
                        {d.lastRun ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <RunStatusBadge status={d.lastRun.status} />
                            <span className="text-sm text-fg-muted">
                              {t('evaluations.passedOf', {
                                passed: d.lastRun.passed,
                                total: d.lastRun.total,
                              })}
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm text-fg-muted">{t('evaluations.neverRun')}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('evaluations.newDataset')}</DialogTitle>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <FormField id="dataset-name" label={t('evaluations.datasetName')} required>
                <Input
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </FormField>
              <FormField id="dataset-description" label={t('evaluations.datasetDescription')}>
                <Textarea
                  value={description}
                  maxLength={2000}
                  rows={3}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FormField>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
                {t('evaluations.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PermissionGate>
  );
}
