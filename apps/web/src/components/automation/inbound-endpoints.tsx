'use client';

import * as React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Check, Copy, KeyRound, Pencil, Plus, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { Permission, type WebhookEndpoint } from '@hilatech/contracts';
import {
  Button,
  Card,
  CardContent,
  ConfirmDialog,
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
import { env } from '@/lib/env';
import {
  useDeleteWebhookEndpoint,
  useRotateEndpointSecret,
  useUpdateWebhookEndpoint,
  useWebhookEndpoints,
  useWorkflows,
} from '@/hooks/automation';
import { useCan } from '@/hooks/use-can';
import { EndpointDialog } from './endpoint-dialog';
import { SecretDialog } from './secret-dialog';

/** Public URL external systems post to (API origin + the endpoint's /api/v1/hooks path). */
export function endpointUrl(endpoint: Pick<WebhookEndpoint, 'path'>): string {
  return `${env.apiUrl}${endpoint.path}`;
}

export function InboundEndpoints() {
  const canManage = useCan(Permission.AUTOMATIONS_MANAGE);
  const endpoints = useWebhookEndpoints();
  const workflows = useWorkflows({ pageSize: 100 });
  const remove = useDeleteWebhookEndpoint();
  const rotate = useRotateEndpointSecret();
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<WebhookEndpoint | null>(null);
  const [deleting, setDeleting] = React.useState<WebhookEndpoint | null>(null);
  const [rotating, setRotating] = React.useState<WebhookEndpoint | null>(null);
  const [reveal, setReveal] = React.useState<{ title: string; secret: string; url: string } | null>(
    null,
  );
  const columns = 6;
  const workflowName = (id: string | null) =>
    id ? (workflows.data?.data.find((w) => w.id === id)?.name ?? 'Workflow') : null;

  return (
    <section aria-labelledby="inbound-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="inbound-heading" className="text-base font-semibold">
            Inbound endpoints
          </h2>
          <p className="text-sm text-fg-muted">
            Public URLs that start a workflow when an external system calls them.
          </p>
        </div>
        {canManage ? (
          <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
            New endpoint
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table aria-label="Inbound endpoints">
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {endpoints.isPending ? (
                <TableSkeletonRows columns={columns} rows={3} />
              ) : endpoints.isError ? (
                <TableEmptyRow colSpan={columns}>
                  <div className="flex flex-col items-center gap-2">
                    <span>{getErrorMessage(endpoints.error)}</span>
                    <Button variant="secondary" size="sm" onClick={() => void endpoints.refetch()}>
                      Try again
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : endpoints.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    icon={<WebhookIcon />}
                    title="No inbound endpoints yet"
                    description="Create an endpoint, bind it to a workflow with the “Inbound webhook” trigger, and post to its URL."
                  />
                </TableEmptyRow>
              ) : (
                endpoints.data.map((ep) => (
                  <EndpointRow
                    key={ep.id}
                    endpoint={ep}
                    workflowName={workflowName(ep.workflowId)}
                    canManage={canManage}
                    onEdit={() => setEditing(ep)}
                    onRotate={() => setRotating(ep)}
                    onDelete={() => setDeleting(ep)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {creating ? (
        <EndpointDialog
          onClose={() => setCreating(false)}
          onCreated={(c) =>
            setReveal({ title: 'Endpoint created', secret: c.secret, url: endpointUrl(c) })
          }
        />
      ) : null}
      {editing ? <EndpointDialog endpoint={editing} onClose={() => setEditing(null)} /> : null}
      {reveal ? (
        <SecretDialog
          title={reveal.title}
          secret={reveal.secret}
          description="Callers authenticate with this secret."
          onClose={() => setReveal(null)}
        >
          <div className="flex flex-col gap-1.5 text-xs text-fg-muted">
            <p>
              POST to <code className="font-mono break-all text-fg">{reveal.url}</code>
            </p>
            <pre className="overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-[0.6875rem] leading-relaxed text-fg">
              {`curl -X POST '${reveal.url}' \\\n  -H 'content-type: application/json' \\\n  -H 'x-webhook-secret: <secret>' \\\n  -d '{"title":"Hello","message":"From curl"}'`}
            </pre>
            <p>
              Alternatively sign the raw body and send{' '}
              <code className="font-mono">x-hilatech-signature: sha256=&lt;hmac&gt;</code>.
            </p>
          </div>
        </SecretDialog>
      ) : null}
      <ConfirmDialog
        open={!!rotating}
        onOpenChange={(open) => !open && setRotating(null)}
        title="Rotate the endpoint secret?"
        description="A new secret is generated and shown once. Callers using the old secret will be rejected."
        confirmLabel="Rotate secret"
        loading={rotate.isPending}
        onConfirm={async () => {
          if (!rotating) return;
          try {
            const updated = await rotate.mutateAsync(rotating.id);
            setRotating(null);
            setReveal({
              title: 'New endpoint secret',
              secret: updated.secret,
              url: endpointUrl(updated),
            });
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this endpoint?"
        description={
          deleting ? `${endpointUrl(deleting)} will stop accepting requests.` : undefined
        }
        confirmLabel="Delete endpoint"
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success('Endpoint deleted');
            setDeleting(null);
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
    </section>
  );
}

function CopyUrl({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <code className="font-mono text-xs break-all">{url}</code>
      <IconButton
        size="sm"
        label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            toast.error('Copying isn’t available here');
          }
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </IconButton>
    </div>
  );
}

function EndpointRow({
  endpoint,
  workflowName,
  canManage,
  onEdit,
  onRotate,
  onDelete,
}: {
  endpoint: WebhookEndpoint;
  workflowName: string | null;
  canManage: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const update = useUpdateWebhookEndpoint();
  return (
    <TableRow>
      <TableCell className="font-medium">{endpoint.name}</TableCell>
      <TableCell className="max-w-sm">
        <CopyUrl url={endpointUrl(endpoint)} label={`Copy URL of ${endpoint.name}`} />
      </TableCell>
      <TableCell>{workflowName ?? <span className="text-fg-subtle">Not bound</span>}</TableCell>
      <TableCell className="text-right tabular">
        <div className="flex flex-col items-end">
          <span>{endpoint.receivedCount}</span>
          {endpoint.lastReceivedAt ? (
            <span className="text-xs text-fg-muted">
              {formatDistanceToNow(new Date(endpoint.lastReceivedAt), { addSuffix: true })}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Switch
          checked={endpoint.isEnabled}
          disabled={!canManage || update.isPending}
          aria-label={`${endpoint.isEnabled ? 'Disable' : 'Enable'} endpoint ${endpoint.name}`}
          onCheckedChange={(isEnabled) =>
            update.mutate(
              { id: endpoint.id, body: { isEnabled } },
              {
                onSuccess: () => toast.success(`Endpoint ${isEnabled ? 'enabled' : 'disabled'}`),
                onError: (e) => toast.error(getErrorMessage(e)),
              },
            )
          }
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {canManage ? (
            <>
              <IconButton size="sm" label={`Rotate secret for ${endpoint.name}`} onClick={onRotate}>
                <KeyRound aria-hidden />
              </IconButton>
              <IconButton size="sm" label={`Edit endpoint ${endpoint.name}`} onClick={onEdit}>
                <Pencil aria-hidden />
              </IconButton>
              <IconButton size="sm" label={`Delete endpoint ${endpoint.name}`} onClick={onDelete}>
                <Trash2 aria-hidden />
              </IconButton>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
