'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import type { Agent, ExecuteAgentRequest } from '@hilatech/contracts';
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
  SegmentedControl,
  Textarea,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useExecuteAgent } from '@/hooks/queries';
import { AiNotConfigured } from '@/components/ai/ai-not-configured';
import { BudgetExceeded } from '@/components/ai/budget-exceeded';
import { isBudgetExceededError } from '@/lib/billing';

type InputKind = 'text' | 'json';
type Mode = 'async' | 'sync';

/**
 * Builds the execute request from the dialog state. JSON input must be an object (the contract
 * accepts a string or an object); text input is trimmed. Returns an error message instead of throwing.
 */
export function buildExecuteRequest(
  kind: InputKind,
  raw: string,
  mode: Mode,
): { ok: true; body: ExecuteAgentRequest } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'Enter the task or payload for the agent' };
  if (kind === 'text') return { ok: true, body: { input: text, mode } };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ok: false, error: 'JSON input must be an object, e.g. {"leadId": "…"}' };
    return { ok: true, body: { input: parsed as Record<string, unknown>, mode } };
  } catch {
    return { ok: false, error: 'This is not valid JSON' };
  }
}

export function RunAgentDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: Pick<Agent, 'id' | 'name'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <RunForm agent={agent} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RunForm({ agent, onClose }: { agent: Pick<Agent, 'id' | 'name'>; onClose: () => void }) {
  const router = useRouter();
  const execute = useExecuteAgent();
  const [kind, setKind] = React.useState<InputKind>('text');
  const [mode, setMode] = React.useState<Mode>('async');
  const [raw, setRaw] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [notConfigured, setNotConfigured] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [budget, setBudget] = React.useState<{ details: unknown } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setBudget(null);
    const built = buildExecuteRequest(kind, raw, mode);
    if (!built.ok) {
      setFieldError(built.error);
      return;
    }
    setFieldError(null);
    try {
      const execution = await execute.mutateAsync({ id: agent.id, body: built.body });
      toast.success(mode === 'sync' ? 'Run finished' : 'Run queued');
      onClose();
      router.push(`/agents/executions/${execution.id}`);
    } catch (error) {
      if (isBudgetExceededError(error) && isApiError(error)) setBudget({ details: error.details });
      else if (isApiError(error) && error.code === 'AI_NOT_CONFIGURED') setNotConfigured(true);
      else setFormError(getErrorMessage(error));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>Run {agent.name}</DialogTitle>
        <DialogDescription>
          Give the agent a task. You can follow every step of the run.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {notConfigured ? <AiNotConfigured compact /> : null}
        {budget ? <BudgetExceeded details={budget.details} /> : null}
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="flex items-center justify-between gap-3">
          <SegmentedControl
            aria-label="Input type"
            size="sm"
            value={kind}
            onValueChange={(v) => {
              setKind(v);
              setFieldError(null);
            }}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'json', label: 'JSON' },
            ]}
          />
        </div>
        <FormField id="run-input" label="Input" required error={fieldError}>
          <Textarea
            rows={7}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className={kind === 'json' ? 'font-mono text-xs' : undefined}
            placeholder={
              kind === 'json'
                ? '{\n  "leadId": "…"\n}'
                : 'Review today’s new leads and suggest next steps'
            }
          />
        </FormField>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Mode</legend>
          <SegmentedControl
            aria-label="Run mode"
            size="sm"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'async', label: 'Background (async)' },
              { value: 'sync', label: 'Wait for result (sync)' },
            ]}
          />
          <p className="text-xs text-fg-muted">
            {mode === 'async'
              ? 'Queued and run by a worker; the run page updates every 2 seconds.'
              : 'Runs inline with a short time cap — meant for quick tests.'}
          </p>
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={execute.isPending} leadingIcon={<Play aria-hidden />}>
          Run agent
        </Button>
      </DialogFooter>
    </form>
  );
}
