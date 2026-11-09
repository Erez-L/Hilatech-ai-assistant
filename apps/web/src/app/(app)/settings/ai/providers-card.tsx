'use client';

import * as React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { KeyRound, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Permission, type AiProviderConfig } from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import {
  useAiProviders,
  useCheckAiProvider,
  useDeleteAiProvider,
  useUpdateAiProvider,
} from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { HealthBadge } from '@/components/ai/badges';
import { PROVIDER_LABELS, ProviderDialog } from './provider-dialog';

export function ProvidersCard() {
  const canManage = useCan(Permission.AI_CONFIG_MANAGE);
  const providers = useAiProviders();
  const check = useCheckAiProvider();
  const update = useUpdateAiProvider();
  const remove = useDeleteAiProvider();
  const [dialog, setDialog] = React.useState<{ provider?: AiProviderConfig } | null>(null);
  const [deleting, setDeleting] = React.useState<AiProviderConfig | null>(null);
  const [checkingId, setCheckingId] = React.useState<string | null>(null);

  const runCheck = (p: AiProviderConfig) => {
    setCheckingId(p.id);
    check.mutate(p.id, {
      onSuccess: (r) =>
        r.status === 'ok'
          ? toast.success(
              `${p.name} is healthy${r.latencyMs != null ? ` (${r.latencyMs} ms)` : ''}`,
            )
          : toast.error(`${p.name} check failed${r.error ? `: ${r.error}` : ''}`),
      onError: (e) => toast.error(getErrorMessage(e)),
      onSettled: () => setCheckingId(null),
    });
  };

  const columns = 7;
  const list = providers.data ?? [];
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>Providers</CardTitle>
          <CardDescription>
            Where model calls are sent. The default provider serves the assistant and any agent
            without its own choice.
          </CardDescription>
        </div>
        {canManage ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setDialog({})}>
            Add provider
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Health</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Check</span>
              </TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.isPending ? (
              <TableSkeletonRows columns={columns} rows={3} />
            ) : providers.isError ? (
              <TableEmptyRow colSpan={columns}>
                <div className="flex flex-col items-center gap-2">
                  <span>{getErrorMessage(providers.error)}</span>
                  <Button size="sm" variant="secondary" onClick={() => void providers.refetch()}>
                    Try again
                  </Button>
                </div>
              </TableEmptyRow>
            ) : list.length === 0 ? (
              <TableEmptyRow colSpan={columns} className="py-4">
                <EmptyState
                  compact
                  icon={<KeyRound />}
                  title="No AI provider yet"
                  description={
                    canManage
                      ? 'Add a provider and API key to turn on the assistant and agents.'
                      : 'Ask an administrator to add a provider.'
                  }
                  action={
                    canManage ? (
                      <Button
                        size="sm"
                        leadingIcon={<Plus aria-hidden />}
                        onClick={() => setDialog({})}
                      >
                        Add provider
                      </Button>
                    ) : undefined
                  }
                />
              </TableEmptyRow>
            ) : (
              list.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2 font-medium">
                        {p.name}
                        {p.isDefault ? (
                          <Badge variant="accent" className="px-1.5 py-0 text-[0.625rem]">
                            Default
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-xs text-fg-muted">{PROVIDER_LABELS[p.provider]}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.defaultModel}</TableCell>
                  <TableCell className="font-mono text-xs text-fg-muted">
                    {p.hasApiKey
                      ? `••••${p.keyLast4 ?? ''}`
                      : p.provider === 'mock'
                        ? 'Not needed'
                        : 'No key'}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={p.isEnabled}
                      disabled={!canManage || update.isPending}
                      aria-label={`${p.isEnabled ? 'Disable' : 'Enable'} ${p.name}`}
                      onCheckedChange={(isEnabled) =>
                        update.mutate(
                          { id: p.id, body: { isEnabled } },
                          { onError: (e) => toast.error(getErrorMessage(e)) },
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <HealthBadge status={p.lastHealthStatus} />
                      {p.lastHealthCheckAt ? (
                        <span className="text-2xs text-fg-subtle">
                          {formatDistanceToNow(new Date(p.lastHealthCheckAt), { addSuffix: true })}
                        </span>
                      ) : null}
                      {p.lastHealthStatus === 'error' && p.lastHealthError ? (
                        <span
                          className="max-w-48 truncate text-2xs text-danger"
                          title={p.lastHealthError}
                        >
                          {p.lastHealthError}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        leadingIcon={<RefreshCw aria-hidden />}
                        loading={checkingId === p.id}
                        aria-label={`Check ${p.name}`}
                        onClick={() => runCheck(p)}
                      >
                        Check
                      </Button>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton label={`Actions for ${p.name}`} size="sm">
                            <MoreHorizontal aria-hidden />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onSelect={() => setDialog({ provider: p })}>
                            <Pencil aria-hidden />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem tone="danger" onSelect={() => setDeleting(p)}>
                            <Trash2 aria-hidden />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {dialog ? (
        <ProviderDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          provider={dialog.provider}
          first={list.length === 0}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'provider'}?`}
        description="Agents that use this provider block the deletion. The stored key is destroyed."
        confirmLabel="Delete provider"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Provider deleted');
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
