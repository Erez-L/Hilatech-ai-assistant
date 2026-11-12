'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import {
  EVALUATION_LIMITS,
  Permission,
  type EvaluationCase,
  type EvaluationCheck,
  type EvaluationCheckType,
} from '@hilatech/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  IconButton,
  Input,
  LoadingBlock,
  NativeSelect,
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
import { useActiveOrganizationId, useAgents } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { PermissionGate } from '@/components/common/permission-gate';
import { RunStatusBadge } from '@/components/evaluations/status-badges';
import { useFormat, useT } from '@/i18n/provider';
import type { MessageKey } from '@/i18n/messages';

const CHECK_TYPES: EvaluationCheckType[] = ['contains', 'not_contains', 'equals', 'regex'];
const ACTIVE = new Set(['queued', 'running']);

interface CaseDraft {
  id: string | null;
  name: string;
  input: string;
  checks: EvaluationCheck[];
}
const emptyDraft = (): CaseDraft => ({
  id: null,
  name: '',
  input: '',
  checks: [{ type: 'contains', value: '' }],
});

export function DatasetView({ id }: { id: string }) {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const orgId = useActiveOrganizationId();
  const queryClient = useQueryClient();
  const canManage = useCan(Permission.AGENTS_MANAGE);
  const canRun = useCan(Permission.AGENTS_EXECUTE);
  const [draft, setDraft] = React.useState<CaseDraft | null>(null);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [agentId, setAgentId] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const dataset = useQuery({
    queryKey: keys.evaluations(orgId, 'dataset', id),
    queryFn: () => evaluationsApi.dataset(id),
    enabled: !!orgId,
  });
  const runs = useQuery({
    queryKey: keys.evaluations(orgId, 'runs', id),
    queryFn: () => evaluationsApi.runs(id),
    enabled: !!orgId,
    // Poll while a run is in progress so the table follows the worker.
    refetchInterval: (query) =>
      (query.state.data?.data ?? []).some((r) => ACTIVE.has(r.status)) ? 2000 : false,
  });
  const agents = useAgents({ page: 1, pageSize: 100 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.evaluations(orgId) });

  const saveCase = useMutation({
    mutationFn: (d: CaseDraft) => {
      const body = {
        name: d.name.trim(),
        input: d.input.trim(),
        checks: d.checks.map((c) => ({ type: c.type, value: c.value.trim() })),
      };
      return d.id ? evaluationsApi.updateCase(id, d.id, body) : evaluationsApi.addCase(id, body);
    },
    onSuccess: () => {
      void refresh();
      setDraft(null);
      toast.success(t('evaluations.caseSaved'));
    },
    onError: (e) => setDraftError(getErrorMessage(e)),
  });
  const deleteCase = useMutation({
    mutationFn: (caseId: string) => evaluationsApi.deleteCase(id, caseId),
    onSuccess: () => {
      void refresh();
      toast.success(t('evaluations.caseDeleted'));
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const deleteDataset = useMutation({
    mutationFn: () => evaluationsApi.deleteDataset(id),
    onSuccess: () => {
      void refresh();
      toast.success(t('evaluations.datasetDeleted'));
      router.push('/evaluations');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const startRun = useMutation({
    mutationFn: () => evaluationsApi.startRun(id, agentId),
    onSuccess: () => {
      void refresh();
      toast.success(t('evaluations.runStarted'));
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const submitDraft = () => {
    if (!draft) return;
    if (!draft.name.trim()) return setDraftError(t('evaluations.enterAName'));
    if (!draft.input.trim()) return setDraftError(t('evaluations.enterAnInput'));
    if (draft.checks.some((c) => !c.value.trim()))
      return setDraftError(t('evaluations.enterCheckValue'));
    setDraftError(null);
    saveCase.mutate(draft);
  };
  const editCase = (c: EvaluationCase) => {
    setDraftError(null);
    setDraft({ id: c.id, name: c.name, input: c.input, checks: c.checks.map((x) => ({ ...x })) });
  };
  const setCheck = (index: number, patch: Partial<EvaluationCheck>) =>
    setDraft((d) =>
      d ? { ...d, checks: d.checks.map((c, i) => (i === index ? { ...c, ...patch } : c)) } : d,
    );

  if (dataset.isLoading) return <LoadingBlock />;
  if (dataset.isError || !dataset.data) {
    return <Alert tone="danger">{getErrorMessage(dataset.error)}</Alert>;
  }
  const data = dataset.data;
  const atLimit = data.cases.length >= EVALUATION_LIMITS.maxCasesPerDataset;
  const runRows = runs.data?.data ?? [];

  return (
    <PermissionGate anyOf={[Permission.AGENTS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={
            <Link href="/evaluations" className="inline-flex items-center gap-1 hover:text-fg">
              <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
              {t('evaluations.evaluations')}
            </Link>
          }
          title={data.name}
          description={data.description ?? undefined}
          actions={
            canManage ? (
              <Button
                variant="secondary"
                leadingIcon={<Trash2 aria-hidden />}
                onClick={() => setConfirmDelete(true)}
              >
                {t('evaluations.deleteDataset')}
              </Button>
            ) : null
          }
        />

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>{t('evaluations.cases')}</CardTitle>
            {canManage ? (
              <Button
                size="sm"
                leadingIcon={<Plus aria-hidden />}
                disabled={atLimit}
                onClick={() => {
                  setDraftError(null);
                  setDraft(emptyDraft());
                }}
              >
                {t('evaluations.addCase')}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {atLimit ? (
              <Alert tone="info">
                {t('evaluations.limitReached', { max: EVALUATION_LIMITS.maxCasesPerDataset })}
              </Alert>
            ) : null}
            {data.cases.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('evaluations.noCases')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {data.cases.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="font-medium">{c.name}</span>
                      <p className="line-clamp-2 text-sm text-fg-muted">{c.input}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {c.checks.map((check, i) => (
                          <Badge key={i} variant="neutral">
                            {t(`evaluations.check.${check.type}` as MessageKey)}:{' '}
                            <bdi>{check.value}</bdi>
                          </Badge>
                        ))}
                      </div>
                    </div>
                    {canManage ? (
                      <div className="flex shrink-0 gap-1">
                        <IconButton label={t('evaluations.editCase')} onClick={() => editCase(c)}>
                          <Pencil aria-hidden />
                        </IconButton>
                        <IconButton
                          label={t('evaluations.deleteCase')}
                          onClick={() => deleteCase.mutate(c.id)}
                        >
                          <Trash2 aria-hidden />
                        </IconButton>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('evaluations.runs')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {canRun ? (
              <div className="flex flex-wrap items-end gap-3">
                <FormField
                  id="evaluation-agent"
                  label={t('evaluations.agent')}
                  className="min-w-56"
                >
                  <NativeSelect value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                    <option value="">{t('evaluations.chooseAgent')}</option>
                    {(agents.data?.data ?? [])
                      .filter((a) => a.isEnabled)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </NativeSelect>
                </FormField>
                <Button
                  leadingIcon={<Play aria-hidden />}
                  disabled={!agentId || data.cases.length === 0}
                  loading={startRun.isPending}
                  onClick={() => startRun.mutate()}
                >
                  {t('evaluations.runAgent')}
                </Button>
              </div>
            ) : null}
            {runRows.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('evaluations.noRuns')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('evaluations.agent')}</TableHead>
                    <TableHead>{t('evaluations.status')}</TableHead>
                    <TableHead>{t('evaluations.passRate')}</TableHead>
                    <TableHead>{t('evaluations.started')}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t('common.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.agentName}</TableCell>
                      <TableCell>
                        <RunStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell>
                        {t('evaluations.passedOf', { passed: r.passed, total: r.totalCases })}
                        {r.passRate !== null ? ` (${r.passRate}%)` : ''}
                      </TableCell>
                      <TableCell>{fmt.dateTime(r.createdAt)}</TableCell>
                      <TableCell>
                        <Link
                          href={`/evaluations/runs/${r.id}`}
                          className="text-accent hover:underline"
                        >
                          {t('evaluations.viewRun')}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={draft !== null} onOpenChange={(o) => (!o ? setDraft(null) : undefined)}>
        <DialogContent size="lg">
          {draft ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitDraft();
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {draft.id ? t('evaluations.editCase') : t('evaluations.addCase')}
                </DialogTitle>
              </DialogHeader>
              <DialogBody className="flex flex-col gap-4">
                {draftError ? <Alert tone="danger">{draftError}</Alert> : null}
                <FormField id="case-name" label={t('evaluations.caseName')} required>
                  <Input
                    value={draft.name}
                    maxLength={160}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </FormField>
                <FormField id="case-input" label={t('evaluations.input')} required>
                  <Textarea
                    value={draft.input}
                    rows={4}
                    onChange={(e) => setDraft({ ...draft, input: e.target.value })}
                  />
                </FormField>
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-medium">{t('evaluations.checks')}</legend>
                  <p className="text-sm text-fg-muted">{t('evaluations.checksHint')}</p>
                  {draft.checks.map((check, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <NativeSelect
                        aria-label={t('evaluations.checkType')}
                        className="w-48"
                        value={check.type}
                        onChange={(e) =>
                          setCheck(index, { type: e.target.value as EvaluationCheckType })
                        }
                      >
                        {CHECK_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {t(`evaluations.check.${type}` as MessageKey)}
                          </option>
                        ))}
                      </NativeSelect>
                      <Input
                        aria-label={t('evaluations.checkValue')}
                        className="min-w-40 flex-1"
                        value={check.value}
                        maxLength={2000}
                        onChange={(e) => setCheck(index, { value: e.target.value })}
                      />
                      <IconButton
                        label={t('evaluations.removeCheck')}
                        disabled={draft.checks.length === 1}
                        onClick={() =>
                          setDraft({ ...draft, checks: draft.checks.filter((_, i) => i !== index) })
                        }
                      >
                        <Trash2 aria-hidden />
                      </IconButton>
                    </div>
                  ))}
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      leadingIcon={<Plus aria-hidden />}
                      disabled={draft.checks.length >= EVALUATION_LIMITS.maxChecksPerCase}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          checks: [...draft.checks, { type: 'contains', value: '' }],
                        })
                      }
                    >
                      {t('evaluations.addCheck')}
                    </Button>
                  </div>
                </fieldset>
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" loading={saveCase.isPending}>
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('evaluations.deleteDataset')}
        description={t('evaluations.deleteDatasetConfirm', { name: data.name })}
        confirmLabel={t('common.delete')}
        tone="danger"
        loading={deleteDataset.isPending}
        onConfirm={() => deleteDataset.mutate()}
      />
    </PermissionGate>
  );
}
