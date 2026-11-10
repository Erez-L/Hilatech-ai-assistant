'use client';

import * as React from 'react';
import { Info, KeyRound, Pencil, Plug, PlugZap, Unplug } from 'lucide-react';
import { Permission, type Integration, type IntegrationCatalogueEntry } from '@hilatech/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Skeleton,
  StatusBadge,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import {
  useDisconnectIntegration,
  useIntegrationCatalog,
  useIntegrationStatus,
  useIntegrations,
  useTestIntegration,
} from '@/hooks/integrations';
import { useCan } from '@/hooks/use-can';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { ConnectDialog } from '@/components/integrations/connect-dialog';
import {
  INTEGRATION_STATUS_LABELS,
  INTEGRATION_STATUS_TONES,
  PLANNED_REQUIREMENTS,
  SECRET_LABELS,
  isConnectable,
} from '@/lib/integrations';
import { useT, useFormat } from '@/i18n/provider';
import { tm } from '@/i18n/msg';

type ConnectTarget = { kind: 'rest' | 'n8n'; integration?: Integration };

export function IntegrationsView() {
  const t = useT();
  const canManage = useCan(Permission.INTEGRATIONS_MANAGE);
  const catalog = useIntegrationCatalog();
  const status = useIntegrationStatus();
  const integrations = useIntegrations();
  const [dialog, setDialog] = React.useState<ConnectTarget | null>(null);
  const [disconnecting, setDisconnecting] = React.useState<Integration | null>(null);
  const disconnect = useDisconnectIntegration();

  return (
    <PermissionGate anyOf={[Permission.INTEGRATIONS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('integrations.integrations')}
          description={t('integrations.connectTheSystemsYourWorkflows')}
        />
        <QueryState
          query={catalog}
          errorTitle={t('integrations.theIntegrationCatalogCouldnT')}
          loading={
            <div
              className="grid gap-4 lg:grid-cols-2"
              aria-busy="true"
              aria-label={t('integrations.loadingIntegrations')}
            >
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-44" />
              ))}
            </div>
          }
          isEmpty={(c) => c.length === 0}
          empty={<EmptyState icon={<Plug />} title={t('integrations.noIntegrationsAvailable')} />}
        >
          {(entries) => (
            <ul aria-label={t('integrations.integrations')} className="grid gap-4 lg:grid-cols-2">
              {entries.map((entry) => {
                const summary = status.data?.find((s) => s.kind === entry.kind);
                const connections = (integrations.data ?? []).filter((i) => i.kind === entry.kind);
                return (
                  <li key={entry.kind}>
                    <IntegrationCard
                      entry={entry}
                      connected={summary?.connected ?? 0}
                      connections={connections}
                      loadingConnections={integrations.isPending}
                      connectionsError={
                        integrations.isError ? getErrorMessage(integrations.error) : null
                      }
                      canManage={canManage}
                      onConnect={() => setDialog({ kind: entry.kind as 'rest' | 'n8n' })}
                      onEdit={(integration) =>
                        setDialog({ kind: integration.kind as 'rest' | 'n8n', integration })
                      }
                      onDisconnect={setDisconnecting}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>

        {dialog ? (
          <ConnectDialog
            kind={dialog.kind}
            integration={dialog.integration}
            onClose={() => setDialog(null)}
          />
        ) : null}
        <ConfirmDialog
          open={!!disconnecting}
          onOpenChange={(open) => !open && setDisconnecting(null)}
          title={t('integrations.disconnectThisIntegration')}
          description={
            disconnecting
              ? t('integrations.andItsStoredCredentialsWill', { name: disconnecting.name })
              : undefined
          }
          confirmLabel={t('integrations.disconnect')}
          tone="danger"
          loading={disconnect.isPending}
          onConfirm={async () => {
            if (!disconnecting) return;
            try {
              await disconnect.mutateAsync(disconnecting.id);
              toast.success(t('integrations.disconnected', { name: disconnecting.name }));
              setDisconnecting(null);
            } catch (e) {
              toast.error(getErrorMessage(e));
            }
          }}
        />
      </div>
    </PermissionGate>
  );
}

function IntegrationCard({
  entry,
  connected,
  connections,
  loadingConnections,
  connectionsError,
  canManage,
  onConnect,
  onEdit,
  onDisconnect,
}: {
  entry: IntegrationCatalogueEntry;
  connected: number;
  connections: Integration[];
  loadingConnections: boolean;
  connectionsError: string | null;
  canManage: boolean;
  onConnect: () => void;
  onEdit: (i: Integration) => void;
  onDisconnect: (i: Integration) => void;
}) {
  const t = useT();
  const connectable = isConnectable(entry.kind, entry.liveSupport);
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{entry.name}</h2>
            <p className="mt-1 text-sm text-fg-muted">{entry.description}</p>
          </div>
          {connectable ? (
            <Badge variant={connected > 0 ? 'success' : 'neutral'} dot className="shrink-0">
              {connected > 0
                ? t('integrations.connected', { connected })
                : t('integrations.notConnected')}
            </Badge>
          ) : (
            <Badge variant="warning" className="shrink-0">
              {t('integrations.requiresAProvider')}
            </Badge>
          )}
        </div>

        {!connectable ? (
          <Alert tone="neutral">
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 font-medium">
                <Info className="size-4" aria-hidden /> {t('integrations.notConfigured')}
              </span>
              <span>
                {t(PLANNED_REQUIREMENTS[entry.kind] ?? 'integrations.requiresAProviderIntegration')}{' '}
                {t('integrations.nothingIsSentAndNo')}
              </span>
            </div>
          </Alert>
        ) : null}

        {connectionsError ? (
          <p role="alert" className="text-sm text-danger">
            {connectionsError}
          </p>
        ) : loadingConnections ? (
          <Skeleton className="h-12" aria-label={t('integrations.loadingConnections')} />
        ) : connections.length > 0 ? (
          <ul
            aria-label={t('integrations.connections', { name: entry.name })}
            className="flex flex-col gap-2"
          >
            {connections.map((c) => (
              <ConnectionRow
                key={c.id}
                integration={c}
                canManage={canManage}
                connectable={connectable}
                onEdit={() => onEdit(c)}
                onDisconnect={() => onDisconnect(c)}
              />
            ))}
          </ul>
        ) : connectable ? (
          <p className="text-sm text-fg-muted">
            {canManage
              ? t('integrations.noConnectionYetConnectOne')
              : t('integrations.noConnectionYetAskSomeone')}
          </p>
        ) : null}

        {connectable && canManage ? (
          <div className="mt-auto">
            <Button
              variant="secondary"
              leadingIcon={<PlugZap aria-hidden />}
              aria-label={t('integrations.connect2', { name: entry.name })}
              onClick={onConnect}
            >
              {t('integrations.connect')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConnectionRow({
  integration,
  canManage,
  connectable,
  onEdit,
  onDisconnect,
}: {
  integration: Integration;
  canManage: boolean;
  connectable: boolean;
  onEdit: () => void;
  onDisconnect: () => void;
}) {
  const fmt = useFormat();
  const t = useT();
  const test = useTestIntegration();
  const keys = integration.secretKeys.map((k) => tm(t, SECRET_LABELS[k] ?? k));
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{integration.name}</span>
          <StatusBadge
            status={integration.status}
            tone={INTEGRATION_STATUS_TONES[integration.status]}
            label={t(INTEGRATION_STATUS_LABELS[integration.status])}
          />
          {!integration.isEnabled ? <Badge variant="neutral">{t('common.disabled')}</Badge> : null}
          {!connectable ? (
            <Badge variant="outline">{t('integrations.configurationOnly')}</Badge>
          ) : null}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-1.5">
            {connectable ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={test.isPending}
                  aria-label={t('integrations.testConnection2', { name: integration.name })}
                  onClick={() =>
                    test.mutate(integration.id, {
                      onSuccess: (r) =>
                        r.ok
                          ? toast.success(`${integration.name}: ${r.message}`)
                          : toast.error(`${integration.name}: ${r.message}`),
                      onError: (e) => toast.error(getErrorMessage(e)),
                    })
                  }
                >
                  {t('integrations.testConnection')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Pencil aria-hidden />}
                  aria-label={t('common.edit2', { name: integration.name })}
                  onClick={onEdit}
                >
                  {t('common.edit')}
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Unplug aria-hidden />}
              aria-label={t('integrations.disconnect2', { name: integration.name })}
              onClick={onDisconnect}
            >
              {t('integrations.disconnect')}
            </Button>
          </div>
        ) : null}
      </div>
      <p className="truncate text-xs text-fg-muted">
        {typeof integration.config.baseUrl === 'string' ? integration.config.baseUrl : null}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
        <span className="flex items-center gap-1">
          <KeyRound className="size-3.5" aria-hidden />
          {keys.length > 0
            ? t('integrations.credentialsStored', { keys: keys.join(', ') })
            : t('integrations.noCredentialsStored')}
        </span>
        <span>
          {integration.lastCheckedAt
            ? t('integrations.checked', {
                formatDistanceToNow: fmt.relative(new Date(integration.lastCheckedAt)),
              })
            : t('integrations.neverChecked')}
        </span>
      </p>
      {integration.lastError ? (
        <p className="text-xs break-words text-danger">{integration.lastError}</p>
      ) : null}
    </li>
  );
}
