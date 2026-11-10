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
import { useT } from '@/i18n/provider';

export function OutboundWebhooks() {
  const t = useT();
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
            {t('automation.outboundWebhooks')}
          </h2>
          <p className="text-sm text-fg-muted">{t('automation.sendSignedEventsFromHilatech')}</p>
        </div>
        {canManage ? (
          <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
            {t('automation.newWebhook')}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table aria-label={t('automation.outboundWebhooks')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('automation.endpoint')}</TableHead>
                <TableHead>{t('automation.events')}</TableHead>
                <TableHead>{t('automation.secret')}</TableHead>
                <TableHead>{t('common.enabled')}</TableHead>
                <TableHead className="text-end">
                  <span className="sr-only">{t('common.actions')}</span>
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
                      {t('common.tryAgain')}
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : webhooks.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    icon={<WebhookIcon />}
                    title={t('automation.noOutboundWebhooksYet')}
                    description={t('automation.createOneToReceiveEvents')}
                    action={
                      canManage ? (
                        <Button
                          size="sm"
                          leadingIcon={<Plus aria-hidden />}
                          onClick={() => setCreating(true)}
                        >
                          {t('automation.newWebhook')}
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
          onCreated={(created) => showSecret(t('automation.webhookCreated'), created)}
        />
      ) : null}
      {editing ? <WebhookDialog webhook={editing} onClose={() => setEditing(null)} /> : null}
      {logFor ? <DeliveriesDialog webhook={logFor} onClose={() => setLogFor(null)} /> : null}
      {reveal ? (
        <SecretDialog
          title={reveal.title}
          secret={reveal.secret}
          description={t('automation.useThisSecretToVerify')}
          onClose={() => setReveal(null)}
        >
          <p className="text-xs text-fg-muted">
            {t('automation.deliveriesCarry')}{' '}
            <code className="font-mono">{t('automation.xHilatechSignatureSha256Hmac')}</code>,{' '}
            <code className="font-mono">{t('automation.xHilatechTimestamp')}</code>{' '}
            {t('automation.and')}{' '}
            <code className="font-mono">{t('automation.xHilatechEvent')}</code>{' '}
            {t('automation.headers')}
          </p>
        </SecretDialog>
      ) : null}
      <ConfirmDialog
        open={!!rotating}
        onOpenChange={(open) => !open && setRotating(null)}
        title={t('automation.rotateTheSigningSecret')}
        description={t('automation.aNewSecretIsGenerated2')}
        confirmLabel={t('automation.rotateSecret')}
        loading={rotate.isPending}
        onConfirm={async () => {
          if (!rotating) return;
          try {
            const updated = await rotate.mutateAsync(rotating.id);
            setRotating(null);
            showSecret(t('automation.newSigningSecret'), updated);
          } catch (e) {
            toast.error(getErrorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('automation.deleteThisWebhook')}
        description={
          deleting ? t('automation.andItsDeliveryHistoryWill', { url: deleting.url }) : undefined
        }
        confirmLabel={t('automation.deleteWebhook')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(t('automation.webhookDeleted'));
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
  const t = useT();
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
            <Badge key={ev} variant="outline" title={eventLabel(ev, t)}>
              {ev}
            </Badge>
          ))}
          {webhook.events.length > 3 ? (
            <Badge variant="neutral">
              {t('automation.more', { value: webhook.events.length - 3 })}
            </Badge>
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
          aria-label={t(
            webhook.isEnabled ? 'automation.disableWebhook' : 'automation.enableWebhook',
            { url: webhook.url },
          )}
          onCheckedChange={(isEnabled) =>
            update.mutate(
              { id: webhook.id, body: { isEnabled } },
              {
                onSuccess: () =>
                  toast.success(
                    t(isEnabled ? 'automation.webhookEnabled' : 'automation.webhookDisabled'),
                  ),
                onError: (e) => toast.error(getErrorMessage(e)),
              },
            )
          }
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <IconButton
            size="sm"
            label={t('automation.deliveriesFor', { url: webhook.url })}
            onClick={onLog}
          >
            <History aria-hidden />
          </IconButton>
          {canManage ? (
            <>
              <IconButton
                size="sm"
                label={t('automation.sendTestDeliveryTo', { url: webhook.url })}
                disabled={test.isPending}
                onClick={() =>
                  test.mutate(webhook.id, {
                    onSuccess: () => {
                      toast.success(t('automation.testDeliveryQueued'));
                      onLog();
                    },
                    onError: (e) => toast.error(getErrorMessage(e)),
                  })
                }
              >
                <Send aria-hidden />
              </IconButton>
              <IconButton
                size="sm"
                label={t('automation.rotateSecretFor2', { url: webhook.url })}
                onClick={onRotate}
              >
                <KeyRound aria-hidden />
              </IconButton>
              <IconButton
                size="sm"
                label={t('automation.editWebhook', { url: webhook.url })}
                onClick={onEdit}
              >
                <Pencil aria-hidden />
              </IconButton>
              <IconButton
                size="sm"
                label={t('automation.deleteWebhook2', { url: webhook.url })}
                onClick={onDelete}
              >
                <Trash2 aria-hidden />
              </IconButton>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
