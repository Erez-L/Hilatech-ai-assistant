'use client';

import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileText, MoreHorizontal, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import {
  Permission,
  createPromptTemplateSchema,
  type CreatePromptTemplateRequest,
  type PromptTemplate,
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
  CodeBlock,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  IconButton,
  Input,
  Skeleton,
  Textarea,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useAiPrompts, useDeletePrompt, useRenderPrompt, useSavePrompt } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { extractTemplateVariables } from '@/lib/ai';
import { QueryState } from '@/components/common/query-state';
import { rich } from '@/i18n/rich';
import { useT } from '@/i18n/provider';

export function PromptsCard() {
  const t = useT();
  const canManage = useCan(Permission.AI_CONFIG_MANAGE);
  const prompts = useAiPrompts();
  const remove = useDeletePrompt();
  const [editing, setEditing] = React.useState<{ prompt?: PromptTemplate } | null>(null);
  const [testing, setTesting] = React.useState<PromptTemplate | null>(null);
  const [deleting, setDeleting] = React.useState<PromptTemplate | null>(null);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('settings.promptTemplates')}</CardTitle>
          <CardDescription>
            {rich(t, 'settings.promptTemplatesDescription', {
              code: <code className="font-mono text-xs">{'{{variables}}'}</code>, // i18n-ignore: template syntax
            })}
          </CardDescription>
        </div>
        {canManage ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setEditing({})}>
            {t('settings.newTemplate')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <QueryState
          query={prompts}
          compact
          errorTitle={t('settings.promptTemplatesCouldnTBe')}
          loading={
            <div className="flex flex-col gap-3" aria-busy>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          }
          isEmpty={(d) => d.data.length === 0}
          empty={
            <EmptyState
              compact
              icon={<FileText />}
              title={t('settings.noPromptTemplates')}
              description={t('settings.templatesKeepInstructionsConsistentAcross')}
              action={
                canManage ? (
                  <Button
                    size="sm"
                    leadingIcon={<Plus aria-hidden />}
                    onClick={() => setEditing({})}
                  >
                    {t('settings.newTemplate')}
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {(page) => (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {page.data.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {p.name}
                      <span className="font-mono text-xs font-normal text-fg-subtle">{p.key}</span>
                      {p.isSystem ? (
                        <Badge variant="outline" className="px-1.5 py-0 text-[0.625rem]">
                          {t('common.system')}
                        </Badge>
                      ) : null}
                      <span className="text-xs font-normal text-fg-subtle">v{p.version}</span>
                    </span>
                    {p.description ? (
                      <span className="text-xs text-fg-muted">{p.description}</span>
                    ) : null}
                    {p.variables.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {p.variables.map((v) => (
                          <Badge
                            key={v}
                            variant="outline"
                            className="px-1.5 py-0 font-mono text-[0.625rem]"
                          >
                            {v}
                          </Badge>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      leadingIcon={<Play aria-hidden />}
                      aria-label={t('settings.test2', { name: p.name })}
                      onClick={() => setTesting(p)}
                    >
                      {t('settings.test')}
                    </Button>
                    {canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton label={t('common.actionsFor', { name: p.name })} size="sm">
                            <MoreHorizontal aria-hidden />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onSelect={() => setEditing({ prompt: p })}>
                            <Pencil aria-hidden />
                            {t('common.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            tone="danger"
                            disabled={p.isSystem}
                            onSelect={() => setDeleting(p)}
                          >
                            <Trash2 aria-hidden />
                            {t('common.delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </CardContent>

      {editing ? (
        <PromptDialog
          open
          prompt={editing.prompt}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
      {testing ? (
        <RenderDialog prompt={testing} open onOpenChange={(open) => !open && setTesting(null)} />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('settings.deleteQuoted', { name: deleting?.name ?? '' })}
        description={t('settings.agentsThatReferenceThisTemplate')}
        confirmLabel={t('settings.deleteTemplate')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(t('settings.templateDeleted'));
              setDeleting(null);
            },
            onError: (e) => {
              toast.error(getErrorMessage(e));
              setDeleting(null);
            },
          });
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------

function PromptDialog({
  open,
  onOpenChange,
  prompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt?: PromptTemplate;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <PromptForm prompt={prompt} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PromptForm({ prompt, onDone }: { prompt?: PromptTemplate; onDone: () => void }) {
  const t = useT();
  const save = useSavePrompt();
  const [formError, setFormError] = React.useState<string | null>(null);
  const editing = !!prompt;
  const form = useForm<CreatePromptTemplateRequest>({
    resolver: zodResolver(createPromptTemplateSchema),
    defaultValues: {
      key: prompt?.key ?? '',
      name: prompt?.name ?? '',
      description: prompt?.description ?? '',
      content: prompt?.content ?? '',
    },
  });
  const errors = form.formState.errors;
  const content = useWatch({ control: form.control, name: 'content' });
  const variables = React.useMemo(() => extractTemplateVariables(content ?? ''), [content]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (prompt) {
        await save.mutateAsync({
          id: prompt.id,
          update: {
            name: values.name,
            description: values.description || undefined,
            content: values.content,
          },
        });
      } else {
        await save.mutateAsync({
          create: { ...values, description: values.description || undefined },
        });
      }
      toast.success(t('settings.templateSaved', { name: values.name }));
      onDone();
    } catch (error) {
      if (!applyServerErrors(error, form.setError, ['key', 'name', 'description', 'content']))
        setFormError(getErrorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>
          {editing ? t('common.edit2', { name: prompt.name }) : t('settings.newPromptTemplate')}
        </DialogTitle>
        <DialogDescription>
          {rich(t, 'settings.promptPlaceholderHint', {
            code: <code className="font-mono text-xs">{'{{variable}}'}</code>, // i18n-ignore: template syntax
          })}
          {editing ? t('settings.changingTheContentCreatesA') : ''}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="prompt-name"
            label={t('common.name')}
            required
            error={errors.name?.message}
          >
            <Input autoFocus {...form.register('name')} />
          </FormField>
          <FormField
            id="prompt-key"
            label={t('common.key')}
            required
            error={errors.key?.message}
            description={
              editing
                ? t('settings.theKeyCannotBeChanged')
                : t('settings.lowercaseLettersDigitsAnd')
            }
          >
            <Input disabled={editing} className="font-mono" {...form.register('key')} />
          </FormField>
        </div>
        <FormField
          id="prompt-description"
          label={t('common.description')}
          error={errors.description?.message}
        >
          <Input {...form.register('description')} />
        </FormField>
        <FormField
          id="prompt-content"
          label={t('settings.content')}
          required
          error={errors.content?.message}
        >
          <Textarea rows={10} className="font-mono text-xs" {...form.register('content')} />
        </FormField>
        <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
          <span className="text-fg-muted">{t('settings.variables')}</span>
          {variables.length === 0 ? (
            <span className="text-fg-subtle">{t('settings.noneDetected')}</span>
          ) : (
            variables.map((v) => (
              <Badge key={v} variant="accent" className="font-mono">
                {v}
              </Badge>
            ))
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {editing ? t('common.saveChanges') : t('settings.createTemplate')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------

function RenderDialog({
  prompt,
  open,
  onOpenChange,
}: {
  prompt: PromptTemplate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const render = useRenderPrompt();
  const variables =
    prompt.variables.length > 0 ? prompt.variables : extractTemplateVariables(prompt.content);
  const [values, setValues] = React.useState<Record<string, string>>({});
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('settings.test3', { name: prompt.name })}</DialogTitle>
          <DialogDescription>{t('settings.fillInTheVariablesTo')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 pb-2">
          {variables.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('settings.thisTemplateHasNoVariables')}</p>
          ) : (
            variables.map((v) => (
              <FormField key={v} id={`render-${v}`} label={v}>
                <Input
                  value={values[v] ?? ''}
                  onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))}
                />
              </FormField>
            ))
          )}
          {render.isError ? <Alert tone="danger">{getErrorMessage(render.error)}</Alert> : null}
          {render.data ? (
            <div className="flex flex-col gap-2">
              {render.data.missing.length > 0 ? (
                <Alert tone="warning" title={t('settings.unresolvedPlaceholders')}>
                  {render.data.missing.join(', ')}
                </Alert>
              ) : null}
              <CodeBlock code={render.data.rendered} language="rendered" maxHeight={260} />
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button
            loading={render.isPending}
            onClick={() => render.mutate({ id: prompt.id, body: { variables: values } })}
          >
            {t('settings.render')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
