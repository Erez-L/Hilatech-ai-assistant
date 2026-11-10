'use client';

import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createRoleSchema, type CreateRoleRequest, type Role } from '@hilatech/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Label,
  Skeleton,
  Textarea,
  humanize,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, type PermissionDefinition } from '@/lib/api';
import { useCreateRole, usePermissionCatalog, useUpdateRole } from '@/hooks/queries';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { enumLabel, hasMessage } from '@/i18n/enums';
import type { MessageKey } from '@/i18n/messages';
import { useT } from '@/i18n/provider';

export interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing role to edit/view; undefined creates a new role. */
  role?: Role;
  /** Force read-only (system roles). */
  readOnly?: boolean;
}

function slugifyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);
}

export function RoleDialog({ open, onOpenChange, role, readOnly = false }: RoleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        {/* Keyed by role so switching between roles always starts from that role's values. */}
        <RoleForm
          key={role?.id ?? 'new'}
          role={role}
          readOnly={readOnly}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function RoleForm({
  role,
  readOnly,
  onDone,
}: {
  role?: Role;
  readOnly: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const catalog = usePermissionCatalog();
  const create = useCreateRole();
  const update = useUpdateRole();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [keyTouched, setKeyTouched] = React.useState(!!role);
  const isEdit = !!role;

  const form = useForm<CreateRoleRequest>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: {
      key: role?.key ?? '',
      name: role?.name ?? '',
      description: role?.description ?? '',
      permissions: role?.permissions ?? [],
    },
  });

  const name = useWatch({ control: form.control, name: 'name' });
  React.useEffect(() => {
    if (!isEdit && !keyTouched) form.setValue('key', slugifyKey(name));
  }, [name, isEdit, keyTouched, form]);

  const selected = useWatch({ control: form.control, name: 'permissions' });
  const groups = React.useMemo(() => groupPermissions(catalog.data ?? []), [catalog.data]);

  const toggle = (key: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...selected, key]))
      : selected.filter((p) => p !== key);
    form.setValue('permissions', next, { shouldDirty: true });
  };

  const toggleGroup = (keys: string[], checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...selected, ...keys]))
      : selected.filter((p) => !keys.includes(p));
    form.setValue('permissions', next, { shouldDirty: true });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (isEdit && role) {
        const { key: _key, ...body } = values;
        const updated = await update.mutateAsync({
          id: role.id,
          body: { ...body, description: body.description || undefined },
        });
        toast.success(t('roles.roleSaved', { name: updated.name }));
      } else {
        const created = await create.mutateAsync({
          ...values,
          description: values.description || undefined,
        });
        toast.success(t('roles.roleCreated', { name: created.name }));
      }
      onDone();
    } catch (error) {
      if (!applyServerErrors(error, form.setError, ['key', 'name', 'description', 'permissions'])) {
        setFormError(getErrorMessage(error));
      }
    }
  });

  const title = readOnly
    ? role?.name
    : isEdit
      ? t('roles.editRole', { name: role?.name ?? '' })
      : t('roles.createARole');

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {readOnly ? t('roles.systemRolesAreManagedBy') : t('roles.pickExactlyThePermissionsThis')}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-6 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="role-name"
            label={t('common.name')}
            error={form.formState.errors.name?.message}
            required
          >
            <Input
              autoFocus={!readOnly}
              readOnly={readOnly}
              placeholder={t('roles.salesLead')}
              {...form.register('name')}
            />
          </FormField>
          <FormField
            id="role-key"
            label={t('common.key')}
            description={
              isEdit
                ? t('roles.keysCannotChangeAfterCreation')
                : t('roles.lowercaseLettersNumbersOr')
            }
            error={form.formState.errors.key?.message}
            required
          >
            <Input
              readOnly={isEdit || readOnly}
              placeholder={t('roles.salesLead2')}
              className="font-mono"
              {...form.register('key', { onChange: () => setKeyTouched(true) })}
            />
          </FormField>
        </div>
        <FormField
          id="role-description"
          label={t('common.description')}
          error={form.formState.errors.description?.message}
        >
          <Textarea
            rows={2}
            readOnly={readOnly}
            placeholder={t('roles.whatThisRoleIsFor')}
            {...form.register('description')}
          />
        </FormField>

        <fieldset className="flex flex-col gap-3" disabled={readOnly}>
          <legend className="flex w-full items-baseline justify-between text-sm font-medium">
            <span>{t('common.permissions')}</span>
            <span className="text-xs font-normal text-fg-muted tabular">
              {t('roles.selected', { length: selected.length })}
            </span>
          </legend>
          {form.formState.errors.permissions?.message ? (
            <p role="alert" className="text-xs text-danger">
              {form.formState.errors.permissions.message}
            </p>
          ) : null}
          {catalog.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : catalog.isError ? (
            <Alert tone="danger">
              {t('roles.thePermissionCatalogCouldNot', {
                getErrorMessage: getErrorMessage(catalog.error),
              })}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => void catalog.refetch()}
              >
                {t('common.tryAgain')}
              </button>
            </Alert>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((group) => {
                const keys = group.items.map((i) => i.key);
                const count = keys.filter((k) => selected.includes(k)).length;
                const all = count === keys.length;
                const some = count > 0 && !all;
                const groupId = `perm-group-${group.name}`;
                return (
                  <div key={group.name} className="rounded-md border border-border">
                    <div className="flex items-center gap-2.5 border-b border-border bg-surface-muted/60 px-3 py-2">
                      <Checkbox
                        id={groupId}
                        checked={all ? true : some ? 'indeterminate' : false}
                        onCheckedChange={(c) => toggleGroup(keys, c === true)}
                        aria-label={t('roles.selectAllPermissions', {
                          humanize: enumLabel(t, 'permissionGroup', group.name),
                        })}
                      />
                      <Label htmlFor={groupId} className="flex-1 text-sm">
                        {enumLabel(t, 'permissionGroup', group.name)}
                      </Label>
                      <span className="text-xs text-fg-subtle tabular">
                        {count}/{keys.length}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-2.5 p-3">
                      {group.items.map((perm) => {
                        const id = `perm-${perm.key}`;
                        return (
                          <li key={perm.key} className="flex items-start gap-2.5">
                            <Checkbox
                              id={id}
                              className="mt-0.5"
                              checked={selected.includes(perm.key)}
                              onCheckedChange={(c) => toggle(perm.key, c === true)}
                            />
                            <Label
                              htmlFor={id}
                              className="flex flex-col gap-0.5 font-normal leading-snug"
                            >
                              <span className="text-sm">
                                {hasMessage(`permission.${perm.key}`)
                                  ? t(`permission.${perm.key}` as MessageKey)
                                  : perm.description || describePermission(perm.key)}
                              </span>
                              <span className="font-mono text-2xs text-fg-subtle">{perm.key}</span>
                            </Label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          {readOnly ? t('common.close') : t('common.cancel')}
        </Button>
        {readOnly ? null : (
          <Button type="submit" loading={form.formState.isSubmitting} disabled={catalog.isPending}>
            {isEdit ? t('common.saveChanges') : t('roles.createRole')}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

/** Fallback label when the catalog has no description: "leads:create" → "Create leads". */
export function describePermission(key: string): string {
  const parts = key.split(':');
  const action = parts.at(-1) ?? key;
  const resource = parts.slice(0, -1).join(' ').replace(/_/g, ' ');
  const verbs: Record<string, string> = {
    read: 'View',
    create: 'Create',
    update: 'Edit',
    delete: 'Delete',
    manage: 'Manage',
    invite: 'Invite',
    remove: 'Remove',
    assign: 'Assign',
    execute: 'Run',
    use: 'Use',
  };
  const verb = verbs[action] ?? humanize(action);
  return resource ? `${verb} ${resource}` : verb;
}

export function groupPermissions(
  catalog: PermissionDefinition[],
): { name: string; items: PermissionDefinition[] }[] {
  const map = new Map<string, PermissionDefinition[]>();
  for (const perm of catalog) {
    const group = perm.group || perm.key.split(':')[0] || 'other';
    const list = map.get(group) ?? [];
    list.push(perm);
    map.set(group, list);
  }
  return Array.from(map.entries()).map(([name, items]) => ({
    name,
    items: [...items].sort((a, b) => a.key.localeCompare(b.key)),
  }));
}
