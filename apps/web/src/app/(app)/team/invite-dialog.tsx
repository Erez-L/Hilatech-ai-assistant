'use client';

import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createInvitationSchema,
  type CreateInvitationRequest,
  type Role,
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
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useCreateInvitation } from '@/hooks/queries';
import { applyServerErrors } from '@/lib/forms/server-errors';

export function InviteDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* The form mounts with the dialog content, so it always starts clean. */}
        <InviteForm roles={roles} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ roles, onDone }: { roles: Role[]; onDone: () => void }) {
  const create = useCreateInvitation();
  const [formError, setFormError] = React.useState<string | null>(null);
  const defaultRole = roles.find((r) => r.key === 'member') ?? roles[0];

  const form = useForm<CreateInvitationRequest>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: { email: '', roleId: defaultRole?.id ?? '' },
  });
  const selectedRoleId = useWatch({ control: form.control, name: 'roleId' });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const invitation = await create.mutateAsync(values);
      toast.success(`Invitation sent to ${invitation.email}`);
      onDone();
    } catch (error) {
      if (!applyServerErrors(error, form.setError, ['email', 'roleId']))
        setFormError(getErrorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col">
      <DialogHeader>
        <DialogTitle>Invite a teammate</DialogTitle>
        <DialogDescription>
          They’ll get an email with a link that’s valid for seven days.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-5 pb-2">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <FormField
          id="invite-email"
          label="Email"
          error={form.formState.errors.email?.message}
          required
        >
          <Input
            type="email"
            autoComplete="off"
            autoFocus
            placeholder="name@company.com"
            {...form.register('email')}
          />
        </FormField>
        <FormField
          id="invite-role"
          label="Role"
          description={roles.find((r) => r.id === selectedRoleId)?.description ?? undefined}
          error={form.formState.errors.roleId?.message}
          required
        >
          <NativeSelect {...form.register('roleId')}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Send invitation
        </Button>
      </DialogFooter>
    </form>
  );
}
