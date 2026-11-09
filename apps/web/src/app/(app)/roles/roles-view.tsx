'use client';

import * as React from 'react';
import { Eye, MoreHorizontal, Pencil, Plus, Shield, ShieldCheck, Trash2 } from 'lucide-react';
import { Permission, type Role } from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageHeader,
  Skeleton,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useDeleteRole, useRoles } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { QueryState } from '@/components/common/query-state';
import { PermissionGate } from '@/components/common/permission-gate';
import { RoleDialog } from './role-dialog';

type DialogState =
  { mode: 'create' } | { mode: 'edit'; role: Role } | { mode: 'view'; role: Role } | null;

export function RolesView() {
  const roles = useRoles();
  const remove = useDeleteRole();
  const canManage = useCan(Permission.ROLES_MANAGE);
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [deleting, setDeleting] = React.useState<Role | null>(null);

  const sorted = React.useMemo(() => {
    const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
    return [...(roles.data ?? [])].sort((a, b) => {
      if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
      if (a.isSystem && b.isSystem) return (order[a.key] ?? 9) - (order[b.key] ?? 9);
      return a.name.localeCompare(b.name);
    });
  }, [roles.data]);

  return (
    <PermissionGate anyOf={[Permission.ROLES_READ]}>
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Roles"
          description="Roles bundle permissions. System roles come with every organization; custom roles are yours to shape."
          actions={
            canManage ? (
              <Button
                leadingIcon={<Plus aria-hidden />}
                onClick={() => setDialog({ mode: 'create' })}
              >
                Create role
              </Button>
            ) : undefined
          }
        />

        <QueryState
          query={roles}
          loading={
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-5">
                  <Skeleton className="mb-3 h-5 w-32" />
                  <Skeleton className="mb-4 h-4 w-full" />
                  <Skeleton className="h-3 w-24" />
                </Card>
              ))}
            </div>
          }
          isEmpty={(list) => list.length === 0}
          empty={
            <EmptyState
              icon={<Shield />}
              title="No roles found"
              description="System roles should exist for every organization. If this persists, contact support."
            />
          }
        >
          {() => (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sorted.map((role) => (
                <li key={role.id}>
                  <RoleCard
                    role={role}
                    canManage={canManage}
                    onView={() => setDialog({ mode: 'view', role })}
                    onEdit={() => setDialog({ mode: 'edit', role })}
                    onDelete={() => setDeleting(role)}
                  />
                </li>
              ))}
            </ul>
          )}
        </QueryState>

        <RoleDialog
          open={dialog !== null}
          onOpenChange={(open) => !open && setDialog(null)}
          role={dialog && dialog.mode !== 'create' ? dialog.role : undefined}
          readOnly={dialog?.mode === 'view'}
        />

        <ConfirmDialog
          open={!!deleting}
          onOpenChange={(open) => !open && setDeleting(null)}
          title={deleting ? `Delete “${deleting.name}”?` : ''}
          description="Members holding this role will need a new one before they can keep working. This cannot be undone."
          confirmLabel="Delete role"
          tone="danger"
          loading={remove.isPending}
          onConfirm={() => {
            if (!deleting) return;
            remove.mutate(deleting.id, {
              onSuccess: () => {
                toast.success(`Role “${deleting.name}” deleted`);
                setDeleting(null);
              },
              onError: (e) => toast.error(getErrorMessage(e)),
            });
          }}
        />
      </div>
    </PermissionGate>
  );
}

function RoleCard({
  role,
  canManage,
  onView,
  onEdit,
  onDelete,
}: {
  role: Role;
  canManage: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const editable = canManage && !role.isSystem;
  const open = editable ? onEdit : onView;
  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={open}
            className="flex min-w-0 flex-col gap-1 rounded-xs text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="flex items-center gap-2">
              <span className="truncate text-base font-semibold">{role.name}</span>
              {role.isSystem ? (
                <Badge variant="neutral" className="gap-1">
                  <ShieldCheck aria-hidden />
                  System
                </Badge>
              ) : (
                <Badge variant="accent">Custom</Badge>
              )}
            </span>
            <span className="font-mono text-xs text-fg-subtle">{role.key}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Actions for ${role.name}`}>
                <MoreHorizontal aria-hidden />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onView}>
                <Eye aria-hidden />
                View permissions
              </DropdownMenuItem>
              {editable ? (
                <>
                  <DropdownMenuItem onSelect={onEdit}>
                    <Pencil aria-hidden />
                    Edit role
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem tone="danger" onSelect={onDelete}>
                    <Trash2 aria-hidden />
                    Delete role
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="line-clamp-2 min-h-10 text-sm text-fg-muted">
          {role.description || (role.isSystem ? 'Managed by the platform.' : 'No description.')}
        </p>
        <p className="mt-auto text-xs text-fg-subtle tabular">
          {role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'}
        </p>
      </CardContent>
    </Card>
  );
}
