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
import { useT } from '@/i18n/provider';

export function AgentEditor({ id }: { id?: string }) {
  const t = useT();
  const agent = useAgent(id ?? null);
  return (
    <PermissionGate anyOf={[Permission.AGENTS_READ]}>
      {id ? (
        <QueryState
          query={agent}
          loading={<EditorSkeleton />}
          errorTitle={t('agents.thisAgentCouldnTBe')}
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
  const t = useT();
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
        toast.success(t('agents.agentSaved', { name: saved.name }));
      } else {
        const created = await create.mutateAsync(body);
        toast.success(t('agents.agentCreated', { name: created.name }));
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
            {t('agents.agents')}
          </Link>
        }
        title={agent ? agent.name : t('agents.newAgent')}
        description={
          agent
            ? t('agents.editInstructionsToolsPermissionsAnd')
            : t('agents.defineWhatTheAgentDoes')
        }
        actions={
          agent ? (
            <>
              <Button asChild variant="secondary" leadingIcon={<History aria-hidden />}>
                <Link href={`/agents/executions?agentId=${agent.id}`}>
                  {t('agents.runHistory')}
                </Link>
              </Button>
              {canExecute ? (
                <Button
                  leadingIcon={<Play aria-hidden />}
                  disabled={!agent.isEnabled}
                  title={agent.isEnabled ? undefined : t('agents.enableTheAgentToRun')}
                  onClick={() => setRunOpen(true)}
                >
                  {t('common.run')}
                </Button>
              ) : null}
              {canManage ? (
                <Button
                  variant="danger-outline"
                  leadingIcon={<Trash2 aria-hidden />}
                  onClick={() => setDeleteOpen(true)}
                >
                  {t('common.delete')}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      {readOnly ? <Alert tone="neutral">{t('agents.yourRoleCanViewThis')}</Alert> : null}
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
                  {t('common.discard')}
                </Button>
              ) : (
                <Button asChild variant="ghost">
                  <Link href="/agents">{t('common.cancel')}</Link>
                </Button>
              )}
              <Button
                type="submit"
                loading={form.formState.isSubmitting}
                disabled={agent ? !form.formState.isDirty : false}
              >
                {agent ? t('common.saveChanges') : t('agents.createAgent')}
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
            title={t('agents.deleteThisAgent')}
            description={t('agents.pastRunsAreKeptAn')}
            confirmLabel={t('agents.deleteAgent')}
            tone="danger"
            loading={remove.isPending}
            onConfirm={() => {
              remove.mutate(agent.id, {
                onSuccess: () => {
                  toast.success(t('agents.agentDeleted', { name: agent.name }));
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
