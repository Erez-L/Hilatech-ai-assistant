'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Permission, type TaskWithRelations } from '@hilatech/contracts';
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
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useCreateTask, useUpdateTask } from '@/hooks/sales';
import { useCan } from '@/hooks/use-can';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { contactName } from '@/lib/crm';
import {
  TASK_FORM_FIELDS,
  TaskFormFields,
  taskFormDefaults,
  taskFormSchema,
  toCreateTaskRequest,
  toUpdateTaskRequest,
  type RelatedLabels,
  type TaskFormInput,
  type TaskFormValues,
} from './task-form';
import { useT } from '@/i18n/provider';

export interface TaskRelation {
  leadId?: string;
  contactId?: string;
  dealId?: string;
  conversationId?: string;
  labels?: RelatedLabels;
}

export interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this task; omit to create. */
  task?: TaskWithRelations | null;
  /** Pre-link a new task to a record (and hide that picker). */
  relation?: TaskRelation;
  onSaved?: (task: TaskWithRelations) => void;
}

export function TaskDialog({ open, onOpenChange, task, relation, onSaved }: TaskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {/* Mounted with the dialog so every opening starts from a clean form. */}
        <TaskForm
          key={task?.id ?? 'new'}
          task={task ?? null}
          relation={relation}
          onDone={(saved) => {
            onOpenChange(false);
            if (saved) onSaved?.(saved);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  task,
  relation,
  onDone,
}: {
  task: TaskWithRelations | null;
  relation?: TaskRelation;
  onDone: (task?: TaskWithRelations) => void;
}) {
  const t = useT();
  const create = useCreateTask();
  const update = useUpdateTask();
  const canUpdate = useCan(Permission.TASKS_UPDATE);
  const [formError, setFormError] = React.useState<string | null>(null);
  const editing = !!task;
  const hide = React.useMemo(() => {
    const out: ('lead' | 'contact' | 'deal' | 'conversation')[] = [];
    if (relation?.leadId) out.push('lead');
    if (relation?.contactId) out.push('contact');
    if (relation?.dealId) out.push('deal');
    if (relation?.conversationId) out.push('conversation');
    return out;
  }, [relation]);

  const form = useForm<TaskFormInput, unknown, TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: taskFormDefaults(task, {
      leadId: relation?.leadId ?? task?.leadId ?? '',
      contactId: relation?.contactId ?? task?.contactId ?? '',
      dealId: relation?.dealId ?? task?.dealId ?? '',
      conversationId: relation?.conversationId ?? task?.conversationId ?? '',
    }),
  });

  const labels: RelatedLabels = {
    lead: task?.lead?.title ?? relation?.labels?.lead,
    contact: task?.contact ? contactName(task.contact) : relation?.labels?.contact,
    deal: task?.deal?.title ?? relation?.labels?.deal,
    conversation: task?.conversation?.subject ?? relation?.labels?.conversation,
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = task
        ? await update.mutateAsync({
            id: task.id,
            body: toUpdateTaskRequest(values, task.status !== 'done'),
          })
        : await create.mutateAsync(toCreateTaskRequest(values));
      toast.success(
        task ? t('tasks.taskUpdated', { title: saved.title }) : t('tasks.taskCreated', { title: saved.title }),
      );
      onDone(saved);
    } catch (error) {
      if (!applyServerErrors(error, form.setError, TASK_FORM_FIELDS)) setFormError(getErrorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>{editing ? t('tasks.editTask') : t('tasks.newTask')}</DialogTitle>
        <DialogDescription>
          {editing ? t('tasks.editTaskDescription') : t('tasks.newTaskDescription')}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <TaskFormFields
          form={form}
          editing={editing}
          labels={labels}
          hideRelated={hide}
          autoFocusTitle
          disabled={editing && !canUpdate}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onDone()}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting} disabled={editing && !canUpdate}>
          {editing ? t('common.saveChanges') : t('tasks.createTask')}
        </Button>
      </DialogFooter>
    </form>
  );
}
