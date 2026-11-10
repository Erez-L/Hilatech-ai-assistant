'use client';

import * as React from 'react';
import {
  createKnowledgeBaseSchema,
  Permission,
  updateKnowledgeBaseSchema,
  type KnowledgeBase,
} from '@hilatech/contracts';
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
  Input,
  NativeSelect,
  Textarea,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useAiProviders } from '@/hooks/queries';
import { useCreateKnowledgeBase, useUpdateKnowledgeBase } from '@/hooks/knowledge';
import { useCan } from '@/hooks/use-can';
import { serverFieldErrors, zodFieldErrors } from '@/lib/forms/zod-errors';
import { useT } from '@/i18n/provider';

export function BaseDialog({
  base,
  open,
  onOpenChange,
  onSaved,
}: {
  /** Existing base to edit; omit to create. */
  base?: KnowledgeBase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (base: KnowledgeBase) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <BaseForm base={base} onClose={() => onOpenChange(false)} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}

function BaseForm({
  base,
  onClose,
  onSaved,
}: {
  base?: KnowledgeBase;
  onClose: () => void;
  onSaved?: (base: KnowledgeBase) => void;
}) {
  const t = useT();
  const editing = !!base;
  const create = useCreateKnowledgeBase();
  const update = useUpdateKnowledgeBase();
  const canReadConfig = useCan(Permission.AI_CONFIG_READ);
  const providers = useAiProviders({ enabled: canReadConfig && !editing });
  const [name, setName] = React.useState(base?.name ?? '');
  const [description, setDescription] = React.useState(base?.description ?? '');
  const [providerId, setProviderId] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  const embeddingProviders = (providers.data ?? []).filter(
    (p) => p.isEnabled && (p.provider === 'openai' || p.provider === 'mock'),
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const values = {
      name,
      description: description.trim() ? description : undefined,
    };
    try {
      if (editing && base) {
        const parsed = updateKnowledgeBaseSchema.safeParse({
          name,
          description: description.trim() ? description : undefined,
        });
        if (!parsed.success || !name.trim()) {
          setErrors(parsed.success ? { name: 'Enter a name' } : zodFieldErrors(parsed.error));
          return;
        }
        setErrors({});
        const saved = await update.mutateAsync({ id: base.id, body: parsed.data });
        toast.success(t('knowledge.knowledgeBaseSaved', { name: saved.name }));
        onSaved?.(saved);
        onClose();
        return;
      }
      const parsed = createKnowledgeBaseSchema.safeParse({
        ...values,
        embeddingProviderConfigId: providerId || undefined,
      });
      if (!parsed.success) {
        const found = zodFieldErrors(parsed.error);
        if (found.name) found.name = 'Enter a name (up to 120 characters)';
        setErrors(found);
        return;
      }
      setErrors({});
      const saved = await create.mutateAsync(parsed.data);
      toast.success(t('knowledge.knowledgeBaseCreated', { name: saved.name }));
      onSaved?.(saved);
      onClose();
    } catch (error) {
      const fields = serverFieldErrors(error);
      if (Object.keys(fields).length) setErrors(fields);
      else setFormError(getErrorMessage(error));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>
          {editing ? t('knowledge.editKnowledgeBase') : t('knowledge.newKnowledgeBase')}
        </DialogTitle>
        <DialogDescription>
          {editing
            ? t('knowledge.renameOrReDescribeThis')
            : t('knowledge.aKnowledgeBaseGroupsDocuments')}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <FormField id="kb-name" label={t('common.name')} required error={errors.name}>
          <Input
            value={name}
            maxLength={120}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder={t('knowledge.productHandbook')}
          />
        </FormField>
        <FormField id="kb-description" label={t('common.description')} error={errors.description}>
          <Textarea
            rows={3}
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('knowledge.whatTheseDocumentsCover')}
          />
        </FormField>
        {!editing && canReadConfig ? (
          <FormField
            id="kb-provider"
            label={t('knowledge.embeddingProvider')}
            description={t('knowledge.usedToEmbedDocumentsAnd')}
            error={errors.embeddingProviderConfigId}
          >
            <NativeSelect value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">{t('common.organizationDefault')}</option>
              {embeddingProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={pending}>
          {editing ? t('common.saveChanges') : t('knowledge.createKnowledgeBase')}
        </Button>
      </DialogFooter>
    </form>
  );
}
