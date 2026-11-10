'use client';

import * as React from 'react';
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
import { useT, useFormat } from '@/i18n/provider';

export function ProvidersCard() {
  const fmt = useFormat();
  const t = useT();
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
              r.latencyMs != null
                ? t('settings.providerHealthyMs', { name: p.name, ms: r.latencyMs })
                : t('settings.providerHealthy', { name: p.name }),
            )
          : toast.error(
              r.error
                ? t('settings.providerCheckFailedWith', { name: p.name, error: r.error })
                : t('settings.providerCheckFailed', { name: p.name }),
            ),
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
          <CardTitle>{t('settings.providers')}</CardTitle>
          <CardDescription>{t('settings.whereModelCallsAreSent')}</CardDescription>
        </div>
        {canManage ? (
          <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={() => setDialog({})}>
            {t('settings.addProvider')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.provider')}</TableHead>
              <TableHead>{t('common.model')}</TableHead>
              <TableHead>{t('common.key')}</TableHead>
              <TableHead>{t('common.enabled')}</TableHead>
              <TableHead>{t('settings.health')}</TableHead>
              <TableHead className="text-end">
                <span className="sr-only">{t('settings.check')}</span>
              </TableHead>
              <TableHead className="w-10">
                <span className="sr-only">{t('common.actions')}</span>
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
                    {t('common.tryAgain')}
                  </Button>
                </div>
              </TableEmptyRow>
            ) : list.length === 0 ? (
              <TableEmptyRow colSpan={columns} className="py-4">
                <EmptyState
                  compact
                  icon={<KeyRound />}
                  title={t('settings.noAiProviderYet')}
                  description={
                    canManage
                      ? t('settings.addAProviderAndApi')
                      : t('settings.askAnAdministratorToAdd')
                  }
                  action={
                    canManage ? (
                      <Button
                        size="sm"
                        leadingIcon={<Plus aria-hidden />}
                        onClick={() => setDialog({})}
                      >
                        {t('settings.addProvider')}
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
                            {t('common.default')}
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
                        ? t('settings.notNeeded')
                        : t('settings.noKey')}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={p.isEnabled}
                      disabled={!canManage || update.isPending}
                      aria-label={t(p.isEnabled ? 'common.disableName' : 'common.enableName', {
                        name: p.name,
                      })}
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
                          {fmt.relative(new Date(p.lastHealthCheckAt))}
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
                  <TableCell className="text-end">
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        leadingIcon={<RefreshCw aria-hidden />}
                        loading={checkingId === p.id}
                        aria-label={t('settings.check2', { name: p.name })}
                        onClick={() => runCheck(p)}
                      >
                        {t('settings.check')}
                      </Button>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton label={t('common.actionsFor', { name: p.name })} size="sm">
                            <MoreHorizontal aria-hidden />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onSelect={() => setDialog({ provider: p })}>
                            <Pencil aria-hidden />
                            {t('common.edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem tone="danger" onSelect={() => setDeleting(p)}>
                            <Trash2 aria-hidden />
                            {t('common.delete')}
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
        title={t('settings.deleteNamed', {
          name: deleting?.name ?? t('settings.providerFallback'),
        })}
        description={t('settings.agentsThatUseThisProvider')}
        confirmLabel={t('settings.deleteProvider')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(t('settings.providerDeleted'));
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
