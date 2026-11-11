'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp, Upload } from 'lucide-react';
import {
  Permission,
  type DuplicateStrategy,
  type ImportEntity,
  type ImportFieldSpec,
  type ImportValidation,
} from '@hilatech/contracts';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Label,
  NativeSelect,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, keys } from '@/lib/api';
import { useImportJob, useImportMutations } from '@/hooks/sales';
import { useCan } from '@/hooks/use-can';
import { useSession } from '@/stores/session';
import {
  IMPORT_ENTITIES,
  IMPORT_ENTITY_LABELS,
  WIZARD_STEPS,
  canValidate,
  initialWizardState,
  isTerminalImport,
  missingRequiredFields,
  wizardReducer,
  type WizardState,
  type WizardStep,
} from '@/lib/imports';
import { enumLabel } from '@/i18n/enums';
import { msg, type Msg } from '@/i18n/msg';
import { useT } from '@/i18n/provider';
import { ImportError } from './import-error';
import { ImportResult } from './import-result';

const CREATE_PERMISSION: Record<ImportEntity, string> = {
  contacts: Permission.CONTACTS_CREATE,
  leads: Permission.LEADS_CREATE,
  companies: Permission.COMPANIES_CREATE,
  deals: Permission.DEALS_CREATE,
};

const STEP_LABELS: Record<WizardStep, Msg> = {
  upload: msg('imports.step.upload'),
  mapping: msg('imports.step.mapping'),
  review: msg('imports.step.review'),
  progress: msg('imports.step.progress'),
  result: msg('imports.step.result'),
};

export function useCanImport(entity: ImportEntity): boolean {
  const canImport = useCan(Permission.DATA_IMPORT);
  const canCreate = useCan(CREATE_PERMISSION[entity]);
  return canImport && canCreate;
}

/** "Import" button for a list page; hidden without `data:import` and the entity's create permission. */
export function ImportButton({ entity }: { entity: ImportEntity }) {
  const t = useT();
  const allowed = useCanImport(entity);
  const [open, setOpen] = React.useState(false);
  if (!allowed) return null;
  return (
    <>
      <Button variant="secondary" leadingIcon={<Upload aria-hidden />} onClick={() => setOpen(true)}>
        {t('imports.import')}
      </Button>
      <ImportWizardDialog open={open} onOpenChange={setOpen} entity={entity} />
    </>
  );
}

export function ImportWizardDialog({
  open,
  onOpenChange,
  entity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lock the entity (list pages); omit to let the user choose. */
  entity?: ImportEntity;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-w-4xl" aria-describedby={undefined}>
        <ImportWizard entity={entity} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ step }: { step: WizardStep }) {
  const t = useT();
  const current = WIZARD_STEPS.indexOf(step);
  return (
    <ol className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label={t('imports.steps')}>
      {WIZARD_STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? 'step' : undefined}
          className={cn(
            'flex items-center gap-1.5',
            i === current ? 'font-semibold text-fg' : i < current ? 'text-fg-muted' : 'text-fg-subtle',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'flex size-5 items-center justify-center rounded-full border text-[0.625rem] tabular',
              i === current ? 'border-accent bg-accent text-accent-fg' : 'border-border',
            )}
          >
            {i + 1}
          </span>
          {t(STEP_LABELS[s])}
        </li>
      ))}
    </ol>
  );
}

export function ImportWizard({ entity, onClose }: { entity?: ImportEntity; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const orgId = useSession((s) => s.activeOrganizationId);
  const [state, dispatch] = React.useReducer(wizardReducer, entity ?? 'contacts', initialWizardState);
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const mutations = useImportMutations();
  const polled = useImportJob(state.step === 'progress' ? (state.job?.id ?? null) : null, { poll: true });

  React.useEffect(() => {
    if (polled.data && state.step === 'progress') dispatch({ type: 'progress', job: polled.data });
  }, [polled.data, state.step]);

  // Imports change what the list pages show.
  const finished = state.job && isTerminalImport(state.job.status);
  React.useEffect(() => {
    if (!finished) return;
    for (const key of ['contacts', 'leads', 'companies', 'deals'] as const) {
      void qc.invalidateQueries({ queryKey: ['org', orgId, key] });
    }
    void qc.invalidateQueries({ queryKey: keys.importsRoot(orgId) });
  }, [finished, qc, orgId]);

  const config = { mapping: state.mapping, duplicateStrategy: state.duplicateStrategy };

  const upload = async () => {
    if (!file) return;
    setError(null);
    try {
      dispatch({ type: 'uploaded', upload: await mutations.upload.mutateAsync({ entity: state.entity, file }) });
    } catch (e) {
      setError(e);
    }
  };
  const validate = async () => {
    if (!state.job) return;
    setError(null);
    try {
      dispatch({ type: 'validated', job: await mutations.validate.mutateAsync({ id: state.job.id, body: config }) });
    } catch (e) {
      setError(e);
    }
  };
  const execute = async () => {
    if (!state.job) return;
    setError(null);
    try {
      dispatch({ type: 'started', job: await mutations.execute.mutateAsync({ id: state.job.id, body: config }) });
    } catch (e) {
      setError(e);
    }
  };
  const cancel = async () => {
    if (!state.job) return;
    try {
      await mutations.cancel.mutateAsync(state.job.id);
      toast.success(t('imports.importCancelled'));
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const busy = mutations.upload.isPending || mutations.validate.isPending || mutations.execute.isPending;

  return (
    <div className="flex min-h-0 flex-col" data-testid="import-wizard" data-step={state.step}>
      <DialogHeader>
        <DialogTitle>{t('imports.importData')}</DialogTitle>
        <DialogDescription className="sr-only">{t('imports.importDataDescription')}</DialogDescription>
        <StepIndicator step={state.step} />
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {error ? <ImportError error={error} /> : null}

        {state.step === 'upload' ? (
          <UploadStep
            entity={state.entity}
            lockedEntity={!!entity}
            file={file}
            onEntity={(e) => dispatch({ type: 'entity', entity: e })}
            onFile={(f) => {
              setFile(f);
              setError(null);
            }}
          />
        ) : null}

        {state.step === 'mapping' && state.upload ? (
          <MappingStep
            state={state}
            onMap={(field, column) => dispatch({ type: 'map', field, column })}
            onReset={() => dispatch({ type: 'resetMapping' })}
            onStrategy={(strategy) => dispatch({ type: 'strategy', strategy })}
          />
        ) : null}

        {state.step === 'review' && state.validation ? (
          <ReviewStep
            validation={state.validation}
            strategy={state.duplicateStrategy}
            stale={state.stale}
            onStrategy={(strategy) => dispatch({ type: 'strategy', strategy })}
          />
        ) : null}

        {state.step === 'progress' && state.job ? <ProgressStep job={state.job} /> : null}
        {state.step === 'result' && state.job ? <ImportResult job={state.job} /> : null}
      </DialogBody>
      <DialogFooter>
        {state.step === 'upload' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button leadingIcon={<FileUp aria-hidden />} disabled={!file} loading={mutations.upload.isPending} onClick={() => void upload()}>
              {t('imports.uploadAndContinue')}
            </Button>
          </>
        ) : null}
        {state.step === 'mapping' ? (
          <>
            <Button variant="secondary" onClick={() => dispatch({ type: 'back' })} disabled={busy}>
              {t('imports.back')}
            </Button>
            <Button disabled={!canValidate(state)} loading={mutations.validate.isPending} onClick={() => void validate()}>
              {t('imports.validateDryRun')}
            </Button>
          </>
        ) : null}
        {state.step === 'review' ? (
          <>
            <Button variant="secondary" onClick={() => dispatch({ type: 'back' })} disabled={busy}>
              {t('imports.backToMapping')}
            </Button>
            {state.stale ? (
              <Button variant="secondary" loading={mutations.validate.isPending} onClick={() => void validate()}>
                {t('imports.rerunValidation')}
              </Button>
            ) : null}
            <Button
              disabled={state.stale || !state.validation || state.validation.total === 0}
              loading={mutations.execute.isPending}
              onClick={() => void execute()}
            >
              {t('imports.runImport')}
            </Button>
          </>
        ) : null}
        {state.step === 'progress' ? (
          <Button variant="secondary" loading={mutations.cancel.isPending} onClick={() => void cancel()}>
            {t('imports.cancelImport')}
          </Button>
        ) : null}
        {state.step === 'result' ? (
          <>
            <Button variant="secondary" onClick={() => { setFile(null); dispatch({ type: 'restart' }); }}>
              {t('imports.importAnother')}
            </Button>
            <Button onClick={onClose}>{t('imports.done')}</Button>
          </>
        ) : null}
      </DialogFooter>
    </div>
  );
}

// ---------------------------------------------------------------------------

function UploadStep({
  entity,
  lockedEntity,
  file,
  onEntity,
  onFile,
}: {
  entity: ImportEntity;
  lockedEntity: boolean;
  file: File | null;
  onEntity: (entity: ImportEntity) => void;
  onFile: (file: File | null) => void;
}) {
  const t = useT();
  const perms = {
    contacts: useCanImport('contacts'),
    leads: useCanImport('leads'),
    companies: useCanImport('companies'),
    deals: useCanImport('deals'),
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label htmlFor="import-entity">{t('imports.whatAreYouImporting')}</Label>
        <NativeSelect
          id="import-entity"
          value={entity}
          disabled={lockedEntity}
          onChange={(e) => onEntity(e.target.value as ImportEntity)}
        >
          {IMPORT_ENTITIES.filter((e) => perms[e] || e === entity).map((e) => (
            <option key={e} value={e}>
              {t(IMPORT_ENTITY_LABELS[e])}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-file">{t('imports.csvFile')}</Label>
        <input
          id="import-file"
          type="file"
          accept=".csv,text/csv,text/plain,application/vnd.ms-excel"
          className="block w-full rounded-md border border-dashed border-border-strong bg-surface-muted/40 px-4 py-6 text-sm file:me-4 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-fg"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <p className="text-xs text-fg-muted" dir="auto">
            {file.name} · {t('imports.fileSizeKb', { kb: Math.max(1, Math.round(file.size / 1024)) })}
          </p>
        ) : null}
      </div>
      <Alert tone="info">{t('imports.uploadHint')}</Alert>
    </div>
  );
}

function MappingStep({
  state,
  onMap,
  onReset,
  onStrategy,
}: {
  state: WizardState;
  onMap: (field: string, column: number | null) => void;
  onReset: () => void;
  onStrategy: (strategy: DuplicateStrategy) => void;
}) {
  const t = useT();
  const upload = state.upload!;
  const missing = missingRequiredFields(state.entity, state.mapping, upload.headers.length);
  const fieldLabel = (f: ImportFieldSpec) => enumLabel(t, 'imports.field', f.key, f.label);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="import-detected">
        <span className="font-medium" dir="auto">
          {upload.fileName}
        </span>
        <Badge variant="outline">{t('imports.rowsCount', { count: upload.totalRows })}</Badge>
        <Badge variant="outline">{t('imports.encodingValue', { value: upload.encoding ?? '?' })}</Badge>
        <Badge variant="outline">
          {t('imports.delimiterValue', { value: delimiterName(upload.delimiter, t) })}
        </Badge>
      </div>

      <section aria-label={t('imports.samplePreview')} className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t('imports.samplePreview')}</h3>
        <div className="max-h-48 overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                {upload.headers.map((h, i) => (
                  <TableHead key={i} className="whitespace-nowrap" dir="auto">
                    {h || `#${i + 1}`}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {upload.sampleRows.map((row, r) => (
                <TableRow key={r}>
                  {upload.headers.map((_, c) => (
                    <TableCell key={c} className="max-w-48 truncate" dir="auto">
                      {row[c] ?? ''}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-label={t('imports.columnMapping')} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{t('imports.columnMapping')}</h3>
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t('imports.resetToSuggested')}
          </Button>
        </div>
        {missing.length > 0 ? (
          <Alert tone="warning" data-testid="import-missing-required">
            {t('imports.mapRequired', {
              fields: upload.fields
                .filter((f) => missing.includes(f.key))
                .map(fieldLabel)
                .join(', '),
            })}
          </Alert>
        ) : null}
        <div className="overflow-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('imports.field')}</TableHead>
                <TableHead>{t('imports.columnInFile')}</TableHead>
                <TableHead>{t('imports.sampleValue')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upload.fields.map((f) => {
                const col = state.mapping[f.key] ?? null;
                const id = `import-map-${f.key}`;
                return (
                  <TableRow key={f.key}>
                    <TableCell className="align-middle">
                      <Label htmlFor={id} required={f.required}>
                        {fieldLabel(f)}
                      </Label>
                    </TableCell>
                    <TableCell className="min-w-48">
                      <NativeSelect
                        id={id}
                        value={col === null ? '' : String(col)}
                        onChange={(e) => onMap(f.key, e.target.value === '' ? null : Number(e.target.value))}
                      >
                        <option value="">{t('imports.notImported')}</option>
                        {upload.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || t('imports.columnNumber', { n: i + 1 })}
                          </option>
                        ))}
                      </NativeSelect>
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-fg-muted" dir="auto">
                      {col !== null ? (upload.sampleRows[0]?.[col] ?? '') : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <DuplicateStrategyField value={state.duplicateStrategy} onChange={onStrategy} idPrefix="map" />
    </div>
  );
}

function delimiterName(d: string | null, t: ReturnType<typeof useT>): string {
  if (d === ',') return t('imports.delimiter.comma');
  if (d === ';') return t('imports.delimiter.semicolon');
  if (d === '\t') return t('imports.delimiter.tab');
  if (d === '|') return t('imports.delimiter.pipe');
  return d ?? '?';
}

function DuplicateStrategyField({
  value,
  onChange,
  idPrefix,
}: {
  value: DuplicateStrategy;
  onChange: (v: DuplicateStrategy) => void;
  idPrefix: string;
}) {
  const t = useT();
  const options: { value: DuplicateStrategy; label: string; hint: string }[] = [
    { value: 'skip', label: t('imports.strategy.skip'), hint: t('imports.strategy.skipHint') },
    { value: 'update', label: t('imports.strategy.update'), hint: t('imports.strategy.updateHint') },
    { value: 'create', label: t('imports.strategy.create'), hint: t('imports.strategy.createHint') },
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">{t('imports.duplicateStrategy')}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <label
            key={o.value}
            htmlFor={`${idPrefix}-strategy-${o.value}`}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm',
              value === o.value ? 'border-accent bg-accent-soft' : 'border-border',
            )}
          >
            <input
              id={`${idPrefix}-strategy-${o.value}`}
              type="radio"
              name={`${idPrefix}-duplicate-strategy`}
              className="mt-0.5 size-4 accent-[var(--color-accent)]"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="flex flex-col">
              <span className="font-medium">{o.label}</span>
              <span className="text-xs text-fg-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ReviewStep({
  validation,
  strategy,
  stale,
  onStrategy,
}: {
  validation: ImportValidation;
  strategy: DuplicateStrategy;
  stale: boolean;
  onStrategy: (s: DuplicateStrategy) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-5" data-testid="import-review">
      {stale ? <Alert tone="warning">{t('imports.settingsChangedRerun')}</Alert> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t('imports.totalRows')} value={validation.total} data-testid="validation-total" />
        <StatCard label={t('imports.willBeCreated')} value={validation.valid} data-testid="validation-valid" />
        <StatCard label={t('imports.invalidRows')} value={validation.invalid} data-testid="validation-invalid" />
        <StatCard label={t('imports.duplicateRows')} value={validation.duplicates} data-testid="validation-duplicates" />
      </div>
      <DuplicateStrategyField value={strategy} onChange={onStrategy} idPrefix="review" />
      <section aria-label={t('imports.rowsWithProblems')} className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t('imports.rowsWithProblems')}</h3>
        {validation.rows.length === 0 ? (
          <EmptyState compact title={t('imports.noProblems')} description={t('imports.noProblemsHint')} />
        ) : (
          <>
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">{t('imports.row')}</TableHead>
                    <TableHead className="w-28">{t('common.status')}</TableHead>
                    <TableHead>{t('common.details')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validation.rows.map((r) => (
                    <TableRow key={r.row}>
                      <TableCell className="tabular">{r.row}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'invalid' ? 'danger' : 'warning'}>
                          {enumLabel(t, 'imports.rowStatus', r.status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ul className="flex flex-col gap-0.5 text-sm" dir="auto">
                          {r.errors.map((e, i) => (
                            <li key={i}>
                              {e.field ? <span className="font-medium">{enumLabel(t, 'imports.field', e.field)}: </span> : null}
                              {e.message}
                            </li>
                          ))}
                          {r.duplicateOf ? (
                            <li>
                              {r.duplicateOf.source === 'existing'
                                ? t('imports.duplicateOfExisting', { by: enumLabel(t, 'imports.matchedBy', r.duplicateOf.matchedBy) })
                                : t('imports.duplicateOfRow', {
                                    row: r.duplicateOf.row ?? 0,
                                    by: enumLabel(t, 'imports.matchedBy', r.duplicateOf.matchedBy),
                                  })}
                            </li>
                          ) : null}
                        </ul>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {validation.truncated ? <p className="text-xs text-fg-muted">{t('imports.validationTruncated')}</p> : null}
          </>
        )}
      </section>
    </div>
  );
}

function ProgressStep({ job }: { job: { progress: { processed: number; total: number; percent: number }; status: string } }) {
  const t = useT();
  const { processed, total, percent } = job.progress;
  return (
    <div className="flex flex-col gap-3 py-4" data-testid="import-progress">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {job.status === 'queued' ? t('imports.queued') : t('imports.importing')}
        </span>
        <span className="tabular text-fg-muted">{t('imports.processedOf', { processed, total })}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t('imports.importProgress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={t('imports.percentDone', { percent: Math.round(percent) })}
        className="h-2.5 w-full overflow-hidden rounded-full bg-accent-soft"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(2, percent))}%` }} />
      </div>
    </div>
  );
}
