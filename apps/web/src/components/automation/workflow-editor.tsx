'use client';
import { vm } from '@/i18n/validation';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Play,
  Plus,
  Power,
  PowerOff,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  ALL_DOMAIN_EVENTS,
  Permission,
  type DomainEvent,
  type Workflow,
  type WorkflowStep,
  type WorkflowTrigger,
} from '@hilatech/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  FormField,
  IconButton,
  Input,
  NativeSelect,
  Switch,
  Textarea,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import {
  useCreateWorkflow,
  useSetWorkflowEnabled,
  useUpdateWorkflow,
  useValidateWorkflow,
} from '@/hooks/automation';
import { useCan } from '@/hooks/use-can';
import {
  STEP_META,
  STEP_TYPES,
  TRIGGER_LABELS,
  eventLabel,
  issuesFromError,
  newStep,
  parseIssuePath,
  uniqueStepId,
  type StepType,
  type TriggerType,
  type WorkflowIssue,
} from '@/lib/automation';
import { RunWorkflowDialog } from './run-workflow-dialog';
import { StepFields } from './step-forms';
import { StepFlow } from './step-flow';
import { useT } from '@/i18n/provider';

export interface EditorStep {
  /** Stable React key; independent of the editable step id. */
  key: string;
  step: WorkflowStep;
  /** Raw JSON for steps with a `payload` object, so half-typed JSON isn't lost. */
  payloadText?: string;
}

export interface EditorInitial {
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
}

let keyCounter = 0;
export function toEditorStep(step: WorkflowStep): EditorStep {
  keyCounter += 1;
  const payload =
    step.type === 'n8n_trigger' || step.type === 'outbound_webhook' ? step.payload : undefined;
  return {
    key: `s${keyCounter}`,
    step,
    payloadText: payload ? JSON.stringify(payload, null, 2) : undefined,
  };
}

/** Turns editor state into API steps; invalid JSON payloads are reported as issues. */
export function buildSteps(editorSteps: EditorStep[]): {
  steps: WorkflowStep[];
  problems: WorkflowIssue[];
} {
  const problems: WorkflowIssue[] = [];
  const steps = editorSteps.map(({ step, payloadText }, index) => {
    if (step.type !== 'n8n_trigger' && step.type !== 'outbound_webhook') return step;
    const text = (payloadText ?? '{}').trim() || '{}';
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
      return { ...step, payload: parsed as Record<string, unknown> };
    } catch {
      problems.push({
        stepId: step.id,
        path: `steps[${index}].payload`,
        message: vm('automation.payloadMustBeAValid'),
      });
      return step;
    }
  });
  return { steps, problems };
}

/** Field-level messages for one step, keyed by the step field (`url`, `to.userId`, …). */
export function fieldErrorsFor(issues: WorkflowIssue[], stepId: string, index: number) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const parsed = parseIssuePath(issue.path);
    const matches = issue.stepId === stepId || parsed.index === index;
    if (!matches || issue.stepId === null) continue;
    const rest = parsed.rest.replace(/\[\d+\]/g, '');
    if (rest && !(rest in out)) out[rest] = issue.message;
  }
  return out;
}

export function WorkflowEditor({
  workflow,
  initial,
}: {
  /** Existing workflow to edit; omit to create one. */
  workflow?: Workflow;
  initial?: EditorInitial;
}) {
  const t = useT();
  const router = useRouter();
  const canManage = useCan(Permission.AUTOMATIONS_MANAGE);
  const create = useCreateWorkflow();
  const update = useUpdateWorkflow();
  const validate = useValidateWorkflow();
  const setEnabled = useSetWorkflowEnabled();

  const start: EditorInitial = workflow
    ? {
        name: workflow.name,
        description: workflow.description ?? '',
        trigger: workflow.trigger,
        steps: workflow.steps,
      }
    : (initial ?? { name: '', description: '', trigger: { type: 'manual' }, steps: [] });

  const [name, setName] = React.useState(start.name);
  const [description, setDescription] = React.useState(start.description);
  const [trigger, setTrigger] = React.useState<WorkflowTrigger>(start.trigger);
  const [steps, setSteps] = React.useState<EditorStep[]>(() => start.steps.map(toEditorStep));
  const [enableOnSave, setEnableOnSave] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [issues, setIssues] = React.useState<WorkflowIssue[]>([]);
  const [validated, setValidated] = React.useState<'valid' | 'invalid' | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [newType, setNewType] = React.useState<StepType>('http_request');
  const [running, setRunning] = React.useState(false);

  const stepIds = steps.map((s) => s.step.id);
  const busy = create.isPending || update.isPending || validate.isPending || setEnabled.isPending;
  const issueCount = (id: string, index: number) =>
    issues.filter((i) => i.stepId === id || parseIssuePath(i.path).index === index).length;
  const globalIssues = issues.filter(
    (i) => i.stepId === null && parseIssuePath(i.path).index === null,
  );

  const touch = () => {
    setValidated(null);
    setFormError(null);
  };
  const updateStep = (key: string, next: WorkflowStep) => {
    touch();
    setSteps((list) =>
      list.map((s) => {
        if (s.key !== key) return s;
        return { ...s, step: next };
      }),
    );
  };
  const renameStep = (key: string, newId: string) => {
    touch();
    setSteps((list) => {
      const old = list.find((s) => s.key === key)?.step.id;
      return list.map((s) => {
        if (s.key === key) return { ...s, step: { ...s.step, id: newId } };
        if (s.step.type === 'condition' && old !== undefined && old !== newId) {
          const swap = (ids: string[]) => ids.map((x) => (x === old ? newId : x));
          return { ...s, step: { ...s.step, then: swap(s.step.then), else: swap(s.step.else) } };
        }
        return s;
      });
    });
  };
  const move = (index: number, delta: -1 | 1) => {
    touch();
    setSteps((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };
  const remove = (key: string) => {
    touch();
    setSteps((list) => {
      const gone = list.find((s) => s.key === key)?.step.id;
      return list
        .filter((s) => s.key !== key)
        .map((s) =>
          s.step.type === 'condition' && gone
            ? {
                ...s,
                step: {
                  ...s.step,
                  then: s.step.then.filter((x) => x !== gone),
                  else: s.step.else.filter((x) => x !== gone),
                },
              }
            : s,
        );
    });
  };
  const add = () => {
    touch();
    const id = uniqueStepId(newType, stepIds);
    setSteps((list) => [...list, toEditorStep(newStep(newType, id))]);
  };
  const focusStep = (key: string) => {
    setCollapsed((set) => {
      const next = new Set(set);
      next.delete(key);
      return next;
    });
    requestAnimationFrame(() =>
      document
        .getElementById(`step-card-${key}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  const changeTrigger = (type: TriggerType) => {
    touch();
    setTrigger(
      type === 'event'
        ? { type, event: ALL_DOMAIN_EVENTS[0] as DomainEvent }
        : type === 'schedule'
          ? { type, cron: '0 8 * * 1-5' }
          : { type },
    );
  };

  const doValidate = async (): Promise<boolean> => {
    setFormError(null);
    const built = buildSteps(steps);
    if (built.problems.length > 0) {
      setIssues(built.problems);
      setValidated('invalid');
      return false;
    }
    try {
      const result = await validate.mutateAsync({ trigger, steps: built.steps });
      setIssues(result.issues);
      setValidated(result.valid ? 'valid' : 'invalid');
      return result.valid;
    } catch (error) {
      const found = issuesFromError(error, stepIds);
      if (found.length > 0) {
        setIssues(found);
        setValidated('invalid');
      } else {
        setFormError(getErrorMessage(error));
      }
      return false;
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setNameError('Enter a name');
      return;
    }
    setNameError(null);
    const built = buildSteps(steps);
    if (built.problems.length > 0) {
      setIssues(built.problems);
      setValidated('invalid');
      toast.error(t('automation.fixTheHighlightedProblemsFirst'));
      return;
    }
    if (built.steps.length === 0) {
      setFormError(t('automation.addAtLeastOneStep'));
      return;
    }
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
      trigger,
      steps: built.steps,
    };
    try {
      if (workflow) {
        await update.mutateAsync({ id: workflow.id, body });
        setIssues([]);
        toast.success(t('automation.workflowSaved', { name: body.name }));
      } else {
        const created = await create.mutateAsync({ ...body, isEnabled: enableOnSave });
        toast.success(t('common.workflowCreated', { name: created.name }));
        router.replace(`/automations/${created.id}`);
      }
    } catch (error) {
      const found = issuesFromError(error, stepIds);
      if (found.length > 0) {
        setIssues(found);
        setValidated('invalid');
        setFormError(t('automation.theWorkflowHasProblemsThat'));
      } else {
        setFormError(getErrorMessage(error));
      }
    }
  };

  const toggleEnabled = async () => {
    if (!workflow) return;
    setFormError(null);
    try {
      const next = !workflow.isEnabled;
      await setEnabled.mutateAsync({ id: workflow.id, enabled: next });
      toast.success(t(next ? 'automation.workflowEnabled' : 'automation.workflowDisabled'));
    } catch (error) {
      const found = issuesFromError(error, stepIds);
      if (found.length > 0) {
        setIssues(found);
        setValidated('invalid');
        setFormError(t('automation.theWorkflowCanTBe'));
      } else {
        setFormError(getErrorMessage(error));
      }
    }
  };

  const flowSteps = steps.map((s, i) => ({
    key: s.key,
    step: s.step,
    issueCount: issueCount(s.step.id, i),
  }));

  return (
    <form
      onSubmit={save}
      noValidate
      className="flex flex-col gap-6"
      aria-label={t('automation.workflowEditor')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" leadingIcon={<ArrowLeft aria-hidden />}>
          <Link href="/automations">{t('common.allWorkflows')}</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {workflow ? (
            <Badge variant={workflow.isEnabled ? 'success' : 'neutral'} dot>
              {workflow.isEnabled ? t('common.enabled') : t('common.disabled')}
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            leadingIcon={<ShieldCheck aria-hidden />}
            loading={validate.isPending}
            disabled={busy}
            onClick={() => void doValidate()}
          >
            {t('automation.validate')}
          </Button>
          {canManage ? (
            <Button
              type="submit"
              leadingIcon={<Save aria-hidden />}
              loading={create.isPending || update.isPending}
            >
              {workflow ? t('common.saveChanges') : t('common.createWorkflow')}
            </Button>
          ) : null}
          {canManage && workflow ? (
            <Button
              type="button"
              variant="secondary"
              leadingIcon={workflow.isEnabled ? <PowerOff aria-hidden /> : <Power aria-hidden />}
              loading={setEnabled.isPending}
              disabled={busy}
              onClick={() => void toggleEnabled()}
            >
              {workflow.isEnabled
                ? t('automation.disableWorkflow')
                : t('automation.enableWorkflow')}
            </Button>
          ) : null}
          {canManage && workflow ? (
            <Button
              type="button"
              variant="secondary"
              leadingIcon={<Play aria-hidden />}
              disabled={!workflow.isEnabled || busy}
              title={workflow.isEnabled ? undefined : t('common.enableTheWorkflowToRun')}
              onClick={() => setRunning(true)}
            >
              {t('automation.runNow')}
            </Button>
          ) : null}
        </div>
      </div>

      {!canManage ? <Alert tone="info">{t('automation.youCanViewThisWorkflow')}</Alert> : null}
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      {validated ? (
        <div role="status" aria-label={t('automation.validationResult')}>
          {validated === 'valid' ? (
            <Alert tone="success">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4" aria-hidden />
                {t('automation.theWorkflowIsValid')}
              </span>
            </Alert>
          ) : (
            <Alert tone="danger">
              <div className="flex flex-col gap-1.5">
                <p className="font-medium">
                  {t('automation.problemsFound', { count: issues.length })}
                </p>
                <ul aria-label={t('automation.validationIssues')} className="flex flex-col gap-1">
                  {issues.map((issue, i) => {
                    const idx =
                      parseIssuePath(issue.path).index ??
                      steps.findIndex((s) => s.step.id === issue.stepId);
                    const target = idx >= 0 ? steps[idx] : undefined;
                    return (
                      <li
                        key={`${issue.path}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-2"
                      >
                        {issue.stepId && target ? (
                          <button
                            type="button"
                            onClick={() => focusStep(target.key)}
                            className="font-mono text-xs underline underline-offset-2"
                          >
                            {issue.stepId}
                          </button>
                        ) : null}
                        <span className="font-mono text-xs opacity-80">{issue.path}</span>
                        <span>{issue.message}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Alert>
          )}
        </div>
      ) : null}

      <fieldset disabled={!canManage} className="contents">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('common.details')}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <FormField id="wf-name" label={t('common.name')} required error={nameError}>
                  <Input
                    value={name}
                    maxLength={120}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(null);
                    }}
                    placeholder={t('automation.notifyOnNewLead')}
                  />
                </FormField>
                <FormField id="wf-description" label={t('common.description')}>
                  <Textarea
                    rows={2}
                    value={description}
                    maxLength={2000}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </FormField>
                {!workflow ? (
                  <FormField
                    id="wf-enable-on-save"
                    inline
                    label={t('automation.enableRightAfterCreating')}
                    description={t('automation.anEnabledWorkflowIsValidated')}
                  >
                    <Switch checked={enableOnSave} onCheckedChange={setEnableOnSave} />
                  </FormField>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('common.trigger')}</CardTitle>
                <CardDescription>{t('automation.whatStartsThisWorkflow')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {globalIssues.length > 0 ? (
                  <Alert tone="danger">
                    <ul className="flex flex-col gap-1">
                      {globalIssues.map((i, n) => (
                        <li key={n}>
                          <span className="font-mono text-xs">{i.path}</span> {i.message}
                        </li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}
                <FormField id="wf-trigger-type" label={t('automation.triggerType')}>
                  <NativeSelect
                    value={trigger.type}
                    onChange={(e) => changeTrigger(e.target.value as TriggerType)}
                  >
                    {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((kind) => (
                      <option key={kind} value={kind}>
                        {t(TRIGGER_LABELS[kind])}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                {trigger.type === 'event' ? (
                  <FormField id="wf-trigger-event" label={t('common.event')}>
                    <NativeSelect
                      value={trigger.event}
                      onChange={(e) => {
                        touch();
                        setTrigger({ type: 'event', event: e.target.value as DomainEvent });
                      }}
                    >
                      {ALL_DOMAIN_EVENTS.map((ev) => (
                        <option key={ev} value={ev}>
                          {eventLabel(ev, t)} ({ev})
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                ) : null}
                {trigger.type === 'schedule' ? (
                  <FormField
                    id="wf-trigger-cron"
                    label={t('automation.cronExpression')}
                    description={t('automation.fiveFieldsMinuteHourDay')}
                  >
                    <Input
                      className="font-mono"
                      value={trigger.cron}
                      onChange={(e) => {
                        touch();
                        setTrigger({ type: 'schedule', cron: e.target.value });
                      }}
                    />
                  </FormField>
                ) : null}
                {trigger.type === 'webhook' ? (
                  <p className="text-sm text-fg-muted">
                    {t('automation.bindAnInboundWebhookEndpoint')}{' '}
                    <Link href="/automations/webhooks" className="underline underline-offset-2">
                      {t('automation.automationsWebhooks')}
                    </Link>
                    .
                  </p>
                ) : null}
                {trigger.type === 'manual' ? (
                  <p className="text-sm text-fg-muted">
                    {t('automation.runsOnlyWhenSomeoneStarts')}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
              <h2 id="steps-heading" className="text-base font-semibold">
                {t('common.steps')}
              </h2>
              {steps.length === 0 ? (
                <EmptyState
                  compact
                  title={t('automation.noStepsYet')}
                  description={t('automation.addTheFirstStepBelow')}
                />
              ) : (
                <ol aria-label={t('common.steps')} className="flex flex-col gap-3">
                  {steps.map((s, index) => {
                    const meta = STEP_META[s.step.type];
                    const Icon = meta.icon;
                    const open = !collapsed.has(s.key);
                    const errors = fieldErrorsFor(issues, s.step.id, index);
                    const count = issueCount(s.step.id, index);
                    const bodyId = `step-body-${s.key}`;
                    return (
                      <li
                        key={s.key}
                        id={`step-card-${s.key}`}
                        className={`scroll-mt-20 rounded-lg border bg-surface ${count > 0 ? 'border-danger' : 'border-border'}`}
                      >
                        <div className="flex items-center gap-2 px-3 py-2">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={bodyId}
                            onClick={() =>
                              setCollapsed((set) => {
                                const next = new Set(set);
                                if (next.has(s.key)) next.delete(s.key);
                                else next.add(s.key);
                                return next;
                              })
                            }
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {open ? (
                              <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
                            ) : (
                              <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden />
                            )}
                            <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
                            <span className="tabular text-sm text-fg-subtle">{index + 1}.</span>
                            <span className="truncate text-sm font-medium">{t(meta.label)}</span>
                            <span className="truncate font-mono text-xs text-fg-muted">
                              {s.step.id}
                            </span>
                            {count > 0 ? <Badge variant="danger">{count}</Badge> : null}
                          </button>
                          <IconButton
                            size="sm"
                            type="button"
                            label={t('automation.moveStepUp', { id: s.step.id })}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp aria-hidden />
                          </IconButton>
                          <IconButton
                            size="sm"
                            type="button"
                            label={t('automation.moveStepDown', { id: s.step.id })}
                            disabled={index === steps.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown aria-hidden />
                          </IconButton>
                          <IconButton
                            size="sm"
                            type="button"
                            label={t('automation.removeStep', { id: s.step.id })}
                            onClick={() => remove(s.key)}
                          >
                            <Trash2 aria-hidden />
                          </IconButton>
                        </div>
                        {open ? (
                          <div id={bodyId} className="grid gap-4 border-t border-border px-4 py-4">
                            {count > 0 ? (
                              <Alert tone="danger">
                                <ul className="flex flex-col gap-0.5">
                                  {issues
                                    .filter(
                                      (i) =>
                                        i.stepId === s.step.id ||
                                        parseIssuePath(i.path).index === index,
                                    )
                                    .map((i, n) => (
                                      <li key={n}>
                                        <span className="font-mono text-xs opacity-80">
                                          {i.path}
                                        </span>{' '}
                                        {i.message}
                                      </li>
                                    ))}
                                </ul>
                              </Alert>
                            ) : null}
                            <FormField
                              id={`step-${s.key}-id`}
                              label={t('automation.stepId')}
                              description={t('automation.referencedByConditionsAndTemplates')}
                              error={errors.id}
                            >
                              <Input
                                className="font-mono"
                                maxLength={40}
                                value={s.step.id}
                                onChange={(e) => renameStep(s.key, e.target.value)}
                              />
                            </FormField>
                            <StepFields
                              step={s.step}
                              idPrefix={`step-${s.key}`}
                              onChange={(next) => updateStep(s.key, next)}
                              payloadText={s.payloadText}
                              onPayloadText={(text) => {
                                touch();
                                setSteps((list) =>
                                  list.map((x) =>
                                    x.key === s.key ? { ...x, payloadText: text } : x,
                                  ),
                                );
                              }}
                              laterStepIds={stepIds.slice(index + 1)}
                              errors={errors}
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}

              {canManage ? (
                <div className="flex flex-wrap items-end gap-2">
                  <FormField
                    id="wf-new-step-type"
                    label={t('automation.stepType')}
                    className="min-w-56"
                  >
                    <NativeSelect
                      value={newType}
                      onChange={(e) => setNewType(e.target.value as StepType)}
                    >
                      {STEP_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(STEP_META[type].label)}
                        </option>
                      ))}
                    </NativeSelect>
                  </FormField>
                  <Button
                    type="button"
                    variant="secondary"
                    leadingIcon={<Plus aria-hidden />}
                    onClick={add}
                  >
                    {t('automation.addStep')}
                  </Button>
                </div>
              ) : null}
            </section>
          </div>

          <aside
            aria-label={t('automation.flowPreview')}
            className="min-w-0 lg:sticky lg:top-20 lg:self-start"
          >
            <Card>
              <CardHeader>
                <CardTitle>{t('automation.flow')}</CardTitle>
                <CardDescription>{t('automation.stepsRunTopToBottom')}</CardDescription>
              </CardHeader>
              <CardContent>
                <StepFlow trigger={trigger} steps={flowSteps} onSelect={focusStep} />
                {steps.length === 0 ? (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-muted">
                    <CircleAlert className="size-3.5" aria-hidden />{' '}
                    {t('automation.noStepsToShowYet')}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </aside>
        </div>
      </fieldset>

      {workflow ? (
        <RunWorkflowDialog workflow={workflow} open={running} onOpenChange={setRunning} />
      ) : null}
    </form>
  );
}
