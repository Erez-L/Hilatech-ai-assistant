'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, History, Play, Trash2 } from 'lucide-react';
import { Permission, type Agent } from '@hilatech/contracts';
import { Alert, Button, ConfirmDialog, PageHeader, Skeleton, toast } from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useAgent, useCreateAgent, useDeleteAgent, useUpdateAgent } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import {
  AgentFormFields,
  applyAgentServerErrors,
  toAgentRequest,
  useAgentForm,
  type AgentFormValues,
} from './agent-form';
import { RunAgentDialog } from './run-agent-dialog';

export function AgentEditor({ id }: { id?: string }) {
  const agent = useAgent(id ?? null);
  return (
    <PermissionGate anyOf={[Permission.AGENTS_READ]}>
      {id ? (
        <QueryState
          query={agent}
          loading={<EditorSkeleton />}
          errorTitle="This agent couldn’t be loaded"
        >
          {(data) => <EditorBody agent={data} />}
        </QueryState>
      ) : (
        <EditorBody agent={null} />
      )}
    </PermissionGate>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-64 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}

function EditorBody({ agent }: { agent: Agent | null }) {
  const router = useRouter();
  const canManage = useCan(Permission.AGENTS_MANAGE);
  const canExecute = useCan(Permission.AGENTS_EXECUTE);
  const create = useCreateAgent();
  const update = useUpdateAgent();
  const remove = useDeleteAgent();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [runOpen, setRunOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const form = useAgentForm(agent);
  const readOnly = !canManage;

  const onSubmit = form.handleSubmit(async (values: AgentFormValues) => {
    setFormError(null);
    try {
      const body = toAgentRequest(values);
      if (agent) {
        const saved = await update.mutateAsync({ id: agent.id, body });
        form.reset(form.getValues());
        toast.success(`Agent “${saved.name}” saved`);
      } else {
        const created = await create.mutateAsync(body);
        toast.success(`Agent “${created.name}” created`);
        router.replace(`/agents/${created.id}`);
      }
    } catch (error) {
      if (!applyAgentServerErrors(error, form.setError)) setFormError(getErrorMessage(error));
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/agents" className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-3.5" aria-hidden />
            Agents
          </Link>
        }
        title={agent ? agent.name : 'New agent'}
        description={
          agent
            ? 'Edit instructions, tools, permissions and limits.'
            : 'Define what the agent does, which tools it may use and how far it may go.'
        }
        actions={
          agent ? (
            <>
              <Button asChild variant="secondary" leadingIcon={<History aria-hidden />}>
                <Link href={`/agents/executions?agentId=${agent.id}`}>Run history</Link>
              </Button>
              {canExecute ? (
                <Button
                  leadingIcon={<Play aria-hidden />}
                  disabled={!agent.isEnabled}
                  title={agent.isEnabled ? undefined : 'Enable the agent to run it'}
                  onClick={() => setRunOpen(true)}
                >
                  Run
                </Button>
              ) : null}
              {canManage ? (
                <Button
                  variant="danger-outline"
                  leadingIcon={<Trash2 aria-hidden />}
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      {readOnly ? (
        <Alert tone="neutral">Your role can view this agent but not change it.</Alert>
      ) : null}
      {!agent && readOnly ? null : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <AgentFormFields form={form} agentId={agent?.id} disabled={readOnly} />
          {readOnly ? null : (
            <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t border-border bg-bg/90 px-1 py-3 backdrop-blur">
              {agent ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!form.formState.isDirty || form.formState.isSubmitting}
                  onClick={() => form.reset()}
                >
                  Discard
                </Button>
              ) : (
                <Button asChild variant="ghost">
                  <Link href="/agents">Cancel</Link>
                </Button>
              )}
              <Button
                type="submit"
                loading={form.formState.isSubmitting}
                disabled={agent ? !form.formState.isDirty : false}
              >
                {agent ? 'Save changes' : 'Create agent'}
              </Button>
            </div>
          )}
        </form>
      )}

      {agent ? (
        <>
          <RunAgentDialog agent={agent} open={runOpen} onOpenChange={setRunOpen} />
          <ConfirmDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title="Delete this agent?"
            description="Past runs are kept. An agent with queued or running executions cannot be deleted."
            confirmLabel="Delete agent"
            tone="danger"
            loading={remove.isPending}
            onConfirm={() => {
              remove.mutate(agent.id, {
                onSuccess: () => {
                  toast.success(`Agent “${agent.name}” deleted`);
                  router.replace('/agents');
                },
                onError: (e) => {
                  setDeleteOpen(false);
                  toast.error(getErrorMessage(e));
                },
              });
            }}
          />
        </>
      ) : null}
    </div>
  );
}
