'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Permission, effectiveProbability, type Pipeline, type PipelineStage, type StageKind } from '@hilatech/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  IconButton,
  Input,
  Label,
  NativeSelect,
  PageHeader,
  Skeleton,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { usePipelineMutations, usePipelines } from '@/hooks/sales';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { StageKindBadge } from '@/components/deals/deal-badges';
import { DealsTabs } from '@/components/deals/deals-tabs';
import { STAGE_KIND_LABELS, orderedStages } from '@/lib/deals';
import { useT } from '@/i18n/provider';

/** The deals count carried by the API's "stage still has deals" conflict (409). */
export function dealsInConflict(error: unknown): number | null {
  if (!isApiError(error) || error.status !== 409) return null;
  const details = error.details as { deals?: unknown } | undefined;
  return typeof details?.deals === 'number' ? details.deals : null;
}

export function PipelinesView() {
  const t = useT();
  const pipelines = usePipelines();
  const [selectedId, setSelectedId] = React.useState('');
  const [pipelineDialog, setPipelineDialog] = React.useState<'create' | 'rename' | null>(null);
  const m = usePipelineMutations();

  return (
    <PermissionGate anyOf={[Permission.PIPELINES_MANAGE]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('deals.deals')}
          description={t('deals.pipelinesDescription')}
          actions={
            <Button leadingIcon={<Plus aria-hidden />} onClick={() => setPipelineDialog('create')}>
              {t('deals.newPipeline')}
            </Button>
          }
        >
          <DealsTabs />
        </PageHeader>

        <QueryState
          query={pipelines}
          loading={<Skeleton className="h-64 w-full rounded-lg" />}
          errorTitle={t('deals.pipelinesCouldntBeLoaded')}
          isEmpty={(p) => p.length === 0}
          empty={<EmptyState title={t('deals.noPipelines')} description={t('deals.noPipelinesHint')} />}
        >
          {(list) => {
            const pipeline = list.find((p) => p.id === selectedId) ?? list.find((p) => p.isDefault) ?? list[0]!;
            return (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex min-w-56 flex-col gap-1.5">
                    <Label htmlFor="pipelines-select">{t('deals.pipeline')}</Label>
                    <NativeSelect id="pipelines-select" value={pipeline.id} onChange={(e) => setSelectedId(e.target.value)}>
                      {list.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.isDefault ? ` (${t('common.default')})` : ''}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <Button variant="secondary" leadingIcon={<Pencil aria-hidden />} onClick={() => setPipelineDialog('rename')}>
                    {t('deals.renamePipeline')}
                  </Button>
                  {!pipeline.isDefault ? (
                    <Button
                      variant="secondary"
                      leadingIcon={<Star aria-hidden />}
                      loading={m.update.isPending}
                      onClick={() =>
                        m.update.mutate(
                          { id: pipeline.id, body: { isDefault: true } },
                          {
                            onSuccess: () => toast.success(t('deals.pipelineMadeDefault', { name: pipeline.name })),
                            onError: (e) => toast.error(getErrorMessage(e)),
                          },
                        )
                      }
                    >
                      {t('deals.makeDefault')}
                    </Button>
                  ) : null}
                  <DeletePipeline pipeline={pipeline} onDeleted={() => setSelectedId('')} />
                </div>
                <StagesCard pipeline={pipeline} />
                <PipelineDialog
                  mode={pipelineDialog}
                  pipeline={pipeline}
                  onClose={() => setPipelineDialog(null)}
                  onCreated={(p) => setSelectedId(p.id)}
                />
              </>
            );
          }}
        </QueryState>
      </div>
    </PermissionGate>
  );
}

function DeletePipeline({ pipeline, onDeleted }: { pipeline: Pipeline; onDeleted: () => void }) {
  const t = useT();
  const m = usePipelineMutations();
  const [open, setOpen] = React.useState(false);
  const blocked = pipeline.isDefault || pipeline.dealCount > 0;
  return (
    <>
      <Button
        variant="secondary"
        leadingIcon={<Trash2 aria-hidden />}
        disabled={blocked}
        title={blocked ? t('deals.cannotDeletePipelineHint') : undefined}
        onClick={() => setOpen(true)}
      >
        {t('deals.deletePipeline')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('deals.deletePipelineTitle', { name: pipeline.name })}
        description={t('deals.deletePipelineBody')}
        confirmLabel={t('deals.deletePipeline')}
        tone="danger"
        loading={m.remove.isPending}
        onConfirm={() =>
          m.remove.mutate(pipeline.id, {
            onSuccess: () => {
              setOpen(false);
              onDeleted();
              toast.success(t('deals.pipelineDeleted', { name: pipeline.name }));
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </>
  );
}

function PipelineDialog({
  mode,
  pipeline,
  onClose,
  onCreated,
}: {
  mode: 'create' | 'rename' | null;
  pipeline: Pipeline;
  onClose: () => void;
  onCreated: (p: Pipeline) => void;
}) {
  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        {mode ? <PipelineForm mode={mode} pipeline={pipeline} onClose={onClose} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so it starts from the current pipeline name every time. */
function PipelineForm({
  mode,
  pipeline,
  onClose,
  onCreated,
}: {
  mode: 'create' | 'rename';
  pipeline: Pipeline;
  onClose: () => void;
  onCreated: (p: Pipeline) => void;
}) {
  const t = useT();
  const m = usePipelineMutations();
  const [name, setName] = React.useState(mode === 'rename' ? pipeline.name : '');
  const [isDefault, setIsDefault] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('deals.enterAName'));
      return;
    }
    try {
      if (mode === 'create') {
        const created = await m.create.mutateAsync({ name: name.trim(), isDefault });
        toast.success(t('deals.pipelineCreated', { name: created.name }));
        onCreated(created);
      } else {
        await m.update.mutateAsync({ id: pipeline.id, body: { name: name.trim() } });
        toast.success(t('deals.pipelineRenamed'));
      }
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? t('deals.newPipeline') : t('deals.renamePipeline')}</DialogTitle>
            <DialogDescription>
              {mode === 'create' ? t('deals.newPipelineDescription') : t('deals.renamePipelineDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pb-2">
            {error && !name.trim() ? null : error ? <Alert tone="danger">{error}</Alert> : null}
            <FormField id="pipeline-name" label={t('common.name')} required error={error && !name.trim() ? error : undefined}>
              <Input autoFocus dir="auto" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </FormField>
            {mode === 'create' ? (
              <label className="flex items-center gap-2.5 text-sm" htmlFor="pipeline-default">
                <input
                  id="pipeline-default"
                  type="checkbox"
                  className="size-4 accent-[var(--color-accent)]"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                {t('deals.makeThisTheDefaultPipeline')}
              </label>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={m.create.isPending || m.update.isPending}>
              {mode === 'create' ? t('deals.createPipeline') : t('common.saveChanges')}
            </Button>
          </DialogFooter>
    </form>
  );
}

function StagesCard({ pipeline }: { pipeline: Pipeline }) {
  const t = useT();
  const m = usePipelineMutations();
  const stages = orderedStages(pipeline.stages);
  const [editing, setEditing] = React.useState<PipelineStage | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<PipelineStage | null>(null);
  const [conflict, setConflict] = React.useState<{ stage: PipelineStage; deals: number } | null>(null);
  const [moveTo, setMoveTo] = React.useState('');

  const move = (index: number, delta: -1 | 1) => {
    const ids = stages.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    m.reorder.mutate(
      { id: pipeline.id, stageIds: ids },
      { onError: (e) => toast.error(getErrorMessage(e)) },
    );
  };

  const doDelete = (stage: PipelineStage, moveDealsToStageId?: string) =>
    m.deleteStage.mutate(
      { id: pipeline.id, stageId: stage.id, moveDealsToStageId },
      {
        onSuccess: () => {
          setDeleting(null);
          setConflict(null);
          toast.success(t('deals.stageDeleted', { name: stage.name }));
        },
        onError: (error) => {
          const deals = dealsInConflict(error);
          if (deals !== null && !moveDealsToStageId) {
            setDeleting(null);
            setMoveTo('');
            setConflict({ stage, deals });
            return;
          }
          toast.error(getErrorMessage(error));
        },
      },
    );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('deals.stages')}</CardTitle>
          <CardDescription>{t('deals.stagesDescription')}</CardDescription>
        </div>
        <Button variant="secondary" leadingIcon={<Plus aria-hidden />} onClick={() => setEditing('new')}>
          {t('deals.addStage')}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <ol aria-label={t('deals.stages')} className="divide-y divide-border" data-testid="stage-list">
          {stages.map((stage, index) => (
            <li key={stage.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid="stage-row">
              <span className="w-6 text-sm text-fg-subtle tabular" aria-hidden>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium" dir="auto">
                {stage.name}
              </span>
              <StageKindBadge kind={stage.kind} />
              {stage.kind === 'open' ? <Badge variant="outline">{t('deals.probabilityValue', { value: stage.probability })}</Badge> : null}
              <div className="flex items-center gap-1">
                <IconButton
                  size="sm"
                  label={t('deals.moveStageUp', { name: stage.name })}
                  disabled={index === 0 || m.reorder.isPending}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden />
                </IconButton>
                <IconButton
                  size="sm"
                  label={t('deals.moveStageDown', { name: stage.name })}
                  disabled={index === stages.length - 1 || m.reorder.isPending}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden />
                </IconButton>
                <IconButton size="sm" label={t('deals.editStageName', { name: stage.name })} onClick={() => setEditing(stage)}>
                  <Pencil aria-hidden />
                </IconButton>
                <IconButton size="sm" label={t('deals.deleteStageName', { name: stage.name })} onClick={() => setDeleting(stage)}>
                  <Trash2 aria-hidden />
                </IconButton>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>

      <StageDialog pipeline={pipeline} stage={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('deals.deleteStageTitle', { name: deleting?.name ?? '' })}
        description={t('deals.deleteStageBody')}
        confirmLabel={t('deals.deleteStage')}
        tone="danger"
        loading={m.deleteStage.isPending}
        onConfirm={() => { if (deleting) doDelete(deleting); }}
      />

      <Dialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('deals.moveDealsBeforeDeleting')}</DialogTitle>
            <DialogDescription>
              {t('deals.stageStillHasDeals', { name: conflict?.stage.name ?? '', count: conflict?.deals ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-2">
            <FormField id="stage-move-to" label={t('deals.moveDealsTo')} required>
              <NativeSelect value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">{t('deals.chooseAStage')}</option>
                {stages
                  .filter((s) => s.id !== conflict?.stage.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({t(STAGE_KIND_LABELS[s.kind])})
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConflict(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!moveTo}
              loading={m.deleteStage.isPending}
              onClick={() => conflict && doDelete(conflict.stage, moveTo)}
            >
              {t('deals.moveAndDeleteStage')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function StageDialog({
  pipeline,
  stage,
  onClose,
}: {
  pipeline: Pipeline;
  stage: PipelineStage | 'new' | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!stage} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        {stage ? (
          // Keyed on the stage id so a background refetch never resets what the user is typing.
          <StageForm key={stage === 'new' ? 'new' : stage.id} pipeline={pipeline} stage={stage} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StageForm({
  pipeline,
  stage,
  onClose,
}: {
  pipeline: Pipeline;
  stage: PipelineStage | 'new';
  onClose: () => void;
}) {
  const t = useT();
  const m = usePipelineMutations();
  const isNew = stage === 'new';
  const existing = stage && stage !== 'new' ? stage : null;
  const [name, setName] = React.useState(existing?.name ?? '');
  const [kind, setKind] = React.useState<StageKind>(existing?.kind ?? 'open');
  const [probability, setProbability] = React.useState(String(existing?.probability ?? 10));
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('deals.enterAName'));
      return;
    }
    const p = Math.max(0, Math.min(100, Math.round(Number(probability) || 0)));
    const body = { name: name.trim(), kind, probability: effectiveProbability(kind, p) };
    try {
      if (existing) await m.updateStage.mutateAsync({ id: pipeline.id, stageId: existing.id, body });
      else await m.addStage.mutateAsync({ id: pipeline.id, body });
      toast.success(existing ? t('deals.stageSaved', { name: body.name }) : t('deals.stageAdded', { name: body.name }));
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{isNew ? t('deals.addStage') : t('deals.editStage')}</DialogTitle>
            <DialogDescription>{t('deals.stageDialogDescription')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pb-2">
            {error && name.trim() ? <Alert tone="danger">{error}</Alert> : null}
            <FormField id="stage-name" label={t('common.name')} required error={error && !name.trim() ? error : undefined}>
              <Input autoFocus dir="auto" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="stage-kind" label={t('deals.stageKind')} description={t('deals.stageKindHint')}>
                <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as StageKind)}>
                  {(['open', 'won', 'lost'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(STAGE_KIND_LABELS[k])}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="stage-probability" label={t('deals.probability')} description={t('deals.probabilityHint')}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="tabular"
                  disabled={kind !== 'open'}
                  value={kind === 'open' ? probability : String(effectiveProbability(kind, 0))}
                  onChange={(e) => setProbability(e.target.value)}
                />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={m.addStage.isPending || m.updateStage.isPending}>
              {isNew ? t('deals.addStage') : t('common.saveChanges')}
            </Button>
          </DialogFooter>
    </form>
  );
}
