'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { Permission, type WorkflowTemplate } from '@hilatech/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormField,
  Input,
  Skeleton,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useCreateWorkflow, useWorkflowTemplates } from '@/hooks/automation';
import { useCan } from '@/hooks/use-can';
import { QueryState } from '@/components/common/query-state';
import { AgentPicker, UserPicker } from '@/components/automation/pickers';
import { StepFlow } from '@/components/automation/step-flow';
import {
  PLACEHOLDER_ID,
  applyPlaceholders,
  findPlaceholders,
  triggerSummary,
} from '@/lib/automation';
import { useT } from '@/i18n/provider';
import { msg, type Msg } from '@/i18n/msg';

const CATEGORY_LABELS: Record<WorkflowTemplate['category'], Msg> = {
  crm: msg('toolCategory.crm'),
  notifications: msg('toolCategory.notifications'),
  integrations: msg('toolCategory.integrations'),
  ai: msg('toolCategory.ai'),
  scheduling: msg('toolCategory.scheduling'),
};

export function TemplatesView() {
  const t = useT();
  const canManage = useCan(Permission.AUTOMATIONS_MANAGE);
  const templates = useWorkflowTemplates();
  const [selected, setSelected] = React.useState<WorkflowTemplate | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-fg-muted">
        {t('automations.readyMadeWorkflowsPickOne')}
      </p>
      <QueryState
        query={templates}
        errorTitle={t('automations.templatesCouldnTBeLoaded')}
        loading={
          <div
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
            aria-busy="true"
            aria-label={t('automations.loadingTemplates')}
          >
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        }
        isEmpty={(tpl) => tpl.length === 0}
        empty={<EmptyState icon={<Sparkles />} title={t('automations.noTemplatesAvailable')} />}
      >
        {(list) => (
          <ul
            aria-label={t('automations.templates')}
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {list.map((tpl) => (
              <li key={tpl.key}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col gap-3 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-semibold">{tpl.name}</h2>
                      <Badge variant="outline">{t(CATEGORY_LABELS[tpl.category])}</Badge>
                    </div>
                    <p className="text-sm text-fg-muted">{tpl.description}</p>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Badge variant="neutral">{triggerSummary(tpl.trigger, t)}</Badge>
                      <Badge variant="neutral">
                        {tpl.steps.length}{' '}
                        {tpl.steps.length === 1 ? t('automations.step') : t('automations.steps')}
                      </Badge>
                      {tpl.requires.map((r) => (
                        <Badge key={r} variant="warning">
                          {t('automations.needs', { r })}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-auto pt-1">
                      {canManage ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={t('automations.useTemplate2', { name: tpl.name })}
                          onClick={() => setSelected(tpl)}
                        >
                          {t('automations.useTemplate')}
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {selected ? (
        <UseTemplateDialog template={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

export function UseTemplateDialog({
  template,
  onClose,
}: {
  template: WorkflowTemplate;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const create = useCreateWorkflow();
  const placeholders = React.useMemo(() => findPlaceholders(template.steps, t), [template, t]);
  const [name, setName] = React.useState(template.name);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Enter a name';
    for (const p of placeholders) {
      const v = values[p.key]?.trim();
      if (!v || v === PLACEHOLDER_ID)
        next[p.key] =
          p.kind === 'agent' ? t('automations.chooseAnAgent') : t('automations.chooseAPerson');
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        description: template.description,
        isEnabled: false,
        trigger: template.trigger,
        steps: applyPlaceholders(template.steps, values),
      });
      toast.success(t('common.workflowCreated', { name: created.name }));
      onClose();
      router.push(`/automations/${created.id}`);
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  };

  const nonPlaceholderNeeds = template.requires.filter(
    (r) => !['agentId', 'owner userId'].includes(r),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{t('automations.useTemplate3', { name: template.name })}</DialogTitle>
            <DialogDescription>{template.description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pb-2">
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            {nonPlaceholderNeeds.length > 0 ? (
              <Alert tone="warning">
                {t('automations.templateNeeds', { needs: nonPlaceholderNeeds.join(', ') })}
              </Alert>
            ) : null}
            <FormField
              id="tpl-name"
              label={t('automations.workflowName')}
              required
              error={errors.name}
            >
              <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </FormField>
            {placeholders.map((p) => (
              <FormField
                key={p.key}
                id={`tpl-${p.key.replace(/\W/g, '-')}`}
                label={p.label}
                required
                error={errors[p.key]}
              >
                {p.kind === 'agent' ? (
                  <AgentPicker
                    id={`tpl-${p.key.replace(/\W/g, '-')}`}
                    value={values[p.key] ?? ''}
                    invalid={!!errors[p.key]}
                    onChange={(v) => setValues((s) => ({ ...s, [p.key]: v }))}
                  />
                ) : (
                  <UserPicker
                    id={`tpl-${p.key.replace(/\W/g, '-')}`}
                    value={values[p.key] ?? ''}
                    invalid={!!errors[p.key]}
                    onChange={(v) => setValues((s) => ({ ...s, [p.key]: v }))}
                  />
                )}
              </FormField>
            ))}
            <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-surface-muted/40 p-4">
              <StepFlow
                trigger={template.trigger}
                steps={template.steps.map((step, i) => ({ key: `${step.id}-${i}`, step }))}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t('common.createWorkflow')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
