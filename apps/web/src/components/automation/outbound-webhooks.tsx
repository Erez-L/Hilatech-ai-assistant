'use client';

import * as React from 'react';
import {
  History,
  KeyRound,
  Pencil,
  Plus,
  Send,
  Trash2,
  Webhook as WebhookIcon,
} from 'lucide-react';
import { Permission, type Webhook, type WebhookWithSecret } from '@hilatech/contracts';
import {
  Badge,
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
import {
  useDeleteWebhook,
  useRotateWebhookSecret,
  useTestWebhook,
  useUpdateWebhook,
  useWebhooks,
} from '@/hooks/automation';
import { useCan } from '@/hooks/use-can';
import { DeliveriesDialog } from './deliveries-dialog';
import { SecretDialog } from './secret-dialog';
import { WebhookDialog } from './webhook-dialog';
import { eventLabel } from '@/lib/automation';

export function OutboundWebhooks() {
  const canManage = useCan(Permission.AUTOMATIONS_MANAGE);
  const webhooks = useWebhooks();
  const remove = useDeleteWebhook();
  const rotate = useRotateWebhookSecret();
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Webhook | null>(null);
  const [logFor, setLogFor] = React.useState<Webhook | null>(null);
  const [deleting, setDeleting] = React.useState<Webhook | null>(null);
  const [rotating, setRotating] = React.useState<Webhook | null>(null);
  // The one-time secret lives only in this state while its dialog is open.
  const [reveal, setReveal] = React.useState<{ title: string; secret: string } | null>(null);
  const columns = 5;

  const showSecret = (title: string, w: WebhookWithSecret) =>
    setReveal({ title, secret: w.secret });

  return (
    <section aria-labelledby="outbound-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="outbound-heading" className="text-base font-semibold">
            Outbound webhooks
          </h2>
          <p className="text-sm text-fg-muted">
            Send signed events from HilaTech to your own systems.
          </p>
        </div>
        {canManage ? (
          <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
            New webhook
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table aria-label="Outbound webhooks">
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Secret</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.isPending ? (
                <TableSkeletonRows columns={columns} rows={3} />
              ) : webhooks.isError ? (
                <TableEmptyRow colSpan={columns}>
                  <div className="flex flex-col items-center gap-2">
                    <span>{getErrorMessage(webhooks.error)}</span>
                    <Button variant="secondary" size="sm" onClick={() => void webhooks.refetch()}>
                      Try again
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : webhooks.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    icon={<WebhookIcon />}
                    title="No outbound webhooks yet"
                    description="Create one to receive events such as new leads or finished documents."
                    action={
                      canManage ? (
                        <Button
                          size="sm"
                          leadingIcon={<Plus aria-hidden />}
                          onClick={() => setCreating(true)}
                        >
                          New webhook
                        </Button>
                      ) : undefined
                    }
                  />
                </TableEmptyRow>
              ) : (
                webhooks.data.map((w) => (
                  <OutboundRow
                    key={w.id}
                    webhook={w}
                    canManage={canManage}
                    onEdit={() => setEditing(w)}
                    onLog={() => setLogFor(w)}
                    onRotate={() => setRotating(w)}
                    onDelete={() => setDeleting(w)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {creating ? (
        <WebhookDialog
          onClose={() => setCreating(false)}
          onCreated={(created) => showSecret('Webhook created', created)}
        />
      ) : null}
      {editing ? <WebhookDialog webhook={editing} onClose={() => setEditing(null)} /> : null}
      {logFor ? <DeliveriesDialog webhook={logFor} onClose={() => setLogFor(null)} /> : null}
      {reveal ? (
        <SecretDialog
          title={reveal.title}
          secret={reveal.secret}
          description="Use this secret to verify the x-hilatech-signature header on every delivery."
          onClose={() => setReveal(null)}
        >
          <p className="text-xs text-fg-muted">
            Deliveries carry{' '}
            <code className="font-mono">x-hilatech-signature: sha256=&lt;hmac&gt;</code>,{' '}
            <code className="font-mono">x-hilatech-timestamp</code> and{' '}
            <code className="font-mono">x-hilatech-event</code> headers.
          </p>
        </SecretDialog>
      ) : null}
      <ConfirmDialog
        open={!!rotating}
        onOpenChange={(open) => !open && setRotating(null)}
        title="Rotate the signing secret?"
        description="A new secret is generated and shown once. The old secret stops working immediately."
        confirmLabel="Rotate secret"
        loading={rotate.isPending}
        onConfirm={async () => {
          if (!rotating) return;
          try {
            const updated = await rotate.mutateAsync(rotating.id);
            setRotating(null);
            showSecret('New signing secret', updated);
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this webhook?"
        description={
          deleting ? `${deleting.url} and its delivery history will be removed.` : undefined
        }
        confirmLabel="Delete webhook"
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success('Webhook deleted');
            setDeleting(null);
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
    </section>
  );
}

function OutboundRow({
  webhook,
  canManage,
  onEdit,
  onLog,
  onRotate,
  onDelete,
}: {
  webhook: Webhook;
  canManage: boolean;
  onEdit: () => void;
  onLog: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const update = useUpdateWebhook();
  const test = useTestWebhook();
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 max-w-xs flex-col">
          <span className="truncate font-medium">{webhook.url}</span>
          {webhook.description ? (
            <span className="line-clamp-1 text-xs text-fg-muted">{webhook.description}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex max-w-xs flex-wrap gap-1">
          {webhook.events.slice(0, 3).map((ev) => (
            <Badge key={ev} variant="outline" title={eventLabel(ev)}>
              {ev}
            </Badge>
          ))}
          {webhook.events.length > 3 ? (
            <Badge variant="neutral">+{webhook.events.length - 3} more</Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-fg-muted">••••{webhook.secretLast4}</span>
      </TableCell>
      <TableCell>
        <Switch
          checked={webhook.isEnabled}
          disabled={!canManage || update.isPending}
          aria-label={`${webhook.isEnabled ? 'Disable' : 'Enable'} webhook ${webhook.url}`}
          onCheckedChange={(isEnabled) =>
            update.mutate(
              { id: webhook.id, body: { isEnabled } },
              {
                onSuccess: () => toast.success(`Webhook ${isEnabled ? 'enabled' : 'disabled'}`),
                onError: (e) => toast.error(getErrorMessage(e)),
              },
            )
          }
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <IconButton size="sm" label={`Deliveries for ${webhook.url}`} onClick={onLog}>
            <History aria-hidden />
          </IconButton>
          {canManage ? (
            <>
              <IconButton
                size="sm"
                label={`Send test delivery to ${webhook.url}`}
                disabled={test.isPending}
                onClick={() =>
                  test.mutate(webhook.id, {
                    onSuccess: () => {
                      toast.success('Test delivery queued');
                      onLog();
                    },
                    onError: (e) => toast.error(getErrorMessage(e)),
                  })
                }
              >
                <Send aria-hidden />
              </IconButton>
              <IconButton size="sm" label={`Rotate secret for ${webhook.url}`} onClick={onRotate}>
                <KeyRound aria-hidden />
              </IconButton>
              <IconButton size="sm" label={`Edit webhook ${webhook.url}`} onClick={onEdit}>
                <Pencil aria-hidden />
              </IconButton>
              <IconButton size="sm" label={`Delete webhook ${webhook.url}`} onClick={onDelete}>
                <Trash2 aria-hidden />
              </IconButton>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
