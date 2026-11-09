'use client';

import * as React from 'react';
import { formatDistanceToNow } from 'date-fns';
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

type ConnectTarget = { kind: 'rest' | 'n8n'; integration?: Integration };

export function IntegrationsView() {
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
          title="Integrations"
          description="Connect the systems your workflows talk to. Credentials are encrypted, write-only and never shown again."
        />
        <QueryState
          query={catalog}
          errorTitle="The integration catalog couldn’t be loaded"
          loading={
            <div
              className="grid gap-4 lg:grid-cols-2"
              aria-busy="true"
              aria-label="Loading integrations"
            >
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-44" />
              ))}
            </div>
          }
          isEmpty={(c) => c.length === 0}
          empty={<EmptyState icon={<Plug />} title="No integrations available" />}
        >
          {(entries) => (
            <ul aria-label="Integrations" className="grid gap-4 lg:grid-cols-2">
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
          title="Disconnect this integration?"
          description={
            disconnecting
              ? `“${disconnecting.name}” and its stored credentials will be deleted. Workflow steps that use it will fail until it is connected again.`
              : undefined
          }
          confirmLabel="Disconnect"
          tone="danger"
          loading={disconnect.isPending}
          onConfirm={async () => {
            if (!disconnecting) return;
            try {
              await disconnect.mutateAsync(disconnecting.id);
              toast.success(`${disconnecting.name} disconnected`);
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
              {connected > 0 ? `${connected} connected` : 'Not connected'}
            </Badge>
          ) : (
            <Badge variant="warning" className="shrink-0">
              Requires a provider
            </Badge>
          )}
        </div>

        {!connectable ? (
          <Alert tone="neutral">
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 font-medium">
                <Info className="size-4" aria-hidden /> Not configured
              </span>
              <span>
                {PLANNED_REQUIREMENTS[entry.kind] ?? 'Requires a provider integration.'} Nothing is
                sent and no connection is simulated in this release.
              </span>
            </div>
          </Alert>
        ) : null}

        {connectionsError ? (
          <p role="alert" className="text-sm text-danger">
            {connectionsError}
          </p>
        ) : loadingConnections ? (
          <Skeleton className="h-12" aria-label="Loading connections" />
        ) : connections.length > 0 ? (
          <ul aria-label={`${entry.name} connections`} className="flex flex-col gap-2">
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
              ? 'No connection yet. Connect one to use it from workflows.'
              : 'No connection yet. Ask someone with access to connect it.'}
          </p>
        ) : null}

        {connectable && canManage ? (
          <div className="mt-auto">
            <Button
              variant="secondary"
              leadingIcon={<PlugZap aria-hidden />}
              aria-label={`Connect ${entry.name}`}
              onClick={onConnect}
            >
              Connect
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
  const test = useTestIntegration();
  const keys = integration.secretKeys.map((k) => SECRET_LABELS[k] ?? k);
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-surface-muted/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{integration.name}</span>
          <StatusBadge
            status={integration.status}
            tone={INTEGRATION_STATUS_TONES[integration.status]}
            label={INTEGRATION_STATUS_LABELS[integration.status]}
          />
          {!integration.isEnabled ? <Badge variant="neutral">Disabled</Badge> : null}
          {!connectable ? <Badge variant="outline">Configuration only</Badge> : null}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-1.5">
            {connectable ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={test.isPending}
                  aria-label={`Test connection ${integration.name}`}
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
                  Test connection
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Pencil aria-hidden />}
                  aria-label={`Edit ${integration.name}`}
                  onClick={onEdit}
                >
                  Edit
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Unplug aria-hidden />}
              aria-label={`Disconnect ${integration.name}`}
              onClick={onDisconnect}
            >
              Disconnect
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
          {keys.length > 0 ? `Credentials stored: ${keys.join(', ')}` : 'No credentials stored'}
        </span>
        <span>
          {integration.lastCheckedAt
            ? `Checked ${formatDistanceToNow(new Date(integration.lastCheckedAt), { addSuffix: true })}`
            : 'Never checked'}
        </span>
      </p>
      {integration.lastError ? (
        <p className="text-xs break-words text-danger">{integration.lastError}</p>
      ) : null}
    </li>
  );
}
