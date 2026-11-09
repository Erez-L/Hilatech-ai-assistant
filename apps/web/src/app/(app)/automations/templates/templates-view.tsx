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

const CATEGORY_LABELS: Record<WorkflowTemplate['category'], string> = {
  crm: 'CRM',
  notifications: 'Notifications',
  integrations: 'Integrations',
  ai: 'AI',
  scheduling: 'Scheduling',
};

export function TemplatesView() {
  const canManage = useCan(Permission.AUTOMATIONS_MANAGE);
  const templates = useWorkflowTemplates();
  const [selected, setSelected] = React.useState<WorkflowTemplate | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-fg-muted">
        Ready-made workflows. Pick one, choose the people and agents it needs, and it is created
        disabled so you can validate and enable it from the editor.
      </p>
      <QueryState
        query={templates}
        errorTitle="Templates couldn’t be loaded"
        loading={
          <div
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
            aria-busy="true"
            aria-label="Loading templates"
          >
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44" />
            ))}
          </div>
        }
        isEmpty={(t) => t.length === 0}
        empty={<EmptyState icon={<Sparkles />} title="No templates available" />}
      >
        {(list) => (
          <ul aria-label="Templates" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((t) => (
              <li key={t.key}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col gap-3 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-semibold">{t.name}</h2>
                      <Badge variant="outline">{CATEGORY_LABELS[t.category]}</Badge>
                    </div>
                    <p className="text-sm text-fg-muted">{t.description}</p>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <Badge variant="neutral">{triggerSummary(t.trigger)}</Badge>
                      <Badge variant="neutral">
                        {t.steps.length} {t.steps.length === 1 ? 'step' : 'steps'}
                      </Badge>
                      {t.requires.map((r) => (
                        <Badge key={r} variant="warning">
                          Needs {r}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-auto pt-1">
                      {canManage ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={`Use template ${t.name}`}
                          onClick={() => setSelected(t)}
                        >
                          Use template
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
  const router = useRouter();
  const create = useCreateWorkflow();
  const placeholders = React.useMemo(() => findPlaceholders(template.steps), [template]);
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
        next[p.key] = p.kind === 'agent' ? 'Choose an agent' : 'Choose a person';
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
      toast.success(`Workflow “${created.name}” created`);
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
            <DialogTitle>Use template: {template.name}</DialogTitle>
            <DialogDescription>{template.description}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4 pb-2">
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            {nonPlaceholderNeeds.length > 0 ? (
              <Alert tone="warning">
                This template also needs: {nonPlaceholderNeeds.join(', ')}. It can be saved without
                it, but won’t do anything useful until that is set up.
              </Alert>
            ) : null}
            <FormField id="tpl-name" label="Workflow name" required error={errors.name}>
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
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create workflow
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
