'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import type { Workflow } from '@hilatech/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Textarea,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useRunWorkflow } from '@/hooks/automation';
import { rich } from '@/i18n/rich';
import { useT } from '@/i18n/provider';

/** Parses the manual-run input; it must be a JSON object (empty means `{}`). */
export function parseRunInput(
  raw: string,
): { ok: true; input: Record<string, unknown> } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: true, input: {} };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Input must be a JSON object, e.g. {"leadId": "…"}' };
    }
    return { ok: true, input: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'This is not valid JSON' };
  }
}

export function RunWorkflowDialog({
  workflow,
  open,
  onOpenChange,
}: {
  workflow: Pick<Workflow, 'id' | 'name'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <RunForm workflow={workflow} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RunForm({
  workflow,
  onClose,
}: {
  workflow: Pick<Workflow, 'id' | 'name'>;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const run = useRunWorkflow();
  const [raw, setRaw] = React.useState('{}');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsed = parseRunInput(raw);
    if (!parsed.ok) {
      setFieldError(parsed.error);
      return;
    }
    setFieldError(null);
    try {
      const execution = await run.mutateAsync({ id: workflow.id, body: { input: parsed.input } });
      toast.success(t('automation.runQueued'));
      onClose();
      router.push(`/automations/executions/${execution.id}`);
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>{t('common.run2', { name: workflow.name })}</DialogTitle>
        <DialogDescription>
          {rich(t, 'automation.runWorkflowHint', {
            code: <code className="font-mono text-xs">{'{{ trigger.payload… }}'}</code>, // i18n-ignore: template syntax
          })}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <FormField
          id="run-workflow-input"
          label={t('automation.inputJsonObject')}
          error={fieldError}
        >
          <Textarea
            rows={8}
            className="font-mono text-xs"
            spellCheck={false}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={run.isPending} leadingIcon={<Play aria-hidden />}>
          {t('automation.runWorkflow')}
        </Button>
      </DialogFooter>
    </form>
  );
}
