'use client';

import * as React from 'react';
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
import { useT, useFormat } from '@/i18n/provider';

/** Public URL external systems post to (API origin + the endpoint's /api/v1/hooks path). */
export function endpointUrl(endpoint: Pick<WebhookEndpoint, 'path'>): string {
  return `${env.apiUrl}${endpoint.path}`;
}

export function InboundEndpoints() {
  const t = useT();
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
    id
      ? (workflows.data?.data.find((w) => w.id === id)?.name ?? t('automation.workflowFallback'))
      : null;

  return (
    <section aria-labelledby="inbound-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="inbound-heading" className="text-base font-semibold">
            {t('automation.inboundEndpoints')}
          </h2>
          <p className="text-sm text-fg-muted">{t('automation.publicUrlsThatStartA')}</p>
        </div>
        {canManage ? (
          <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
            {t('automation.newEndpoint')}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table aria-label={t('automation.inboundEndpoints')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('automation.endpoint')}</TableHead>
                <TableHead>{t('automation.url')}</TableHead>
                <TableHead>{t('common.workflow')}</TableHead>
                <TableHead className="text-end">{t('automation.received')}</TableHead>
                <TableHead>{t('common.enabled')}</TableHead>
                <TableHead className="text-end">
                  <span className="sr-only">{t('common.actions')}</span>
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
                      {t('common.tryAgain')}
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : endpoints.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    icon={<WebhookIcon />}
                    title={t('automation.noInboundEndpointsYet')}
                    description={t('automation.createAnEndpointBindIt')}
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
            setReveal({
              title: t('automation.endpointCreated'),
              secret: c.secret,
              url: endpointUrl(c),
            })
          }
        />
      ) : null}
      {editing ? <EndpointDialog endpoint={editing} onClose={() => setEditing(null)} /> : null}
      {reveal ? (
        <SecretDialog
          title={reveal.title}
          secret={reveal.secret}
          description={t('automation.callersAuthenticateWithThisSecret')}
          onClose={() => setReveal(null)}
        >
          <div className="flex flex-col gap-1.5 text-xs text-fg-muted">
            <p>
              {t('automation.postTo')}{' '}
              <code className="font-mono break-all text-fg">{reveal.url}</code>
            </p>
            <pre className="overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-[0.6875rem] leading-relaxed text-fg">
              {t('automation.curlXPostHContent', { url: reveal.url })}
            </pre>
            <p>
              {t('automation.alternativelySignTheRawBody')}{' '}
              <code className="font-mono">{t('automation.xHilatechSignatureSha256Hmac')}</code>.
            </p>
          </div>
        </SecretDialog>
      ) : null}
      <ConfirmDialog
        open={!!rotating}
        onOpenChange={(open) => !open && setRotating(null)}
        title={t('automation.rotateTheEndpointSecret')}
        description={t('automation.aNewSecretIsGenerated')}
        confirmLabel={t('automation.rotateSecret')}
        loading={rotate.isPending}
        onConfirm={async () => {
          if (!rotating) return;
          try {
            const updated = await rotate.mutateAsync(rotating.id);
            setRotating(null);
            setReveal({
              title: t('automation.newEndpointSecret'),
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
        title={t('automation.deleteThisEndpoint')}
        description={
          deleting
            ? t('automation.willStopAcceptingRequests', { endpointUrl: endpointUrl(deleting) })
            : undefined
        }
        confirmLabel={t('automation.deleteEndpoint')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(t('automation.endpointDeleted'));
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
  const t = useT();
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
            toast.error(t('automation.copyingIsnTAvailableHere'));
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
  const fmt = useFormat();
  const t = useT();
  const update = useUpdateWebhookEndpoint();
  return (
    <TableRow>
      <TableCell className="font-medium">{endpoint.name}</TableCell>
      <TableCell className="max-w-sm">
        <CopyUrl
          url={endpointUrl(endpoint)}
          label={t('automation.copyUrlOf', { name: endpoint.name })}
        />
      </TableCell>
      <TableCell>
        {workflowName ?? <span className="text-fg-subtle">{t('automation.notBound')}</span>}
      </TableCell>
      <TableCell className="text-end tabular">
        <div className="flex flex-col items-end">
          <span>{endpoint.receivedCount}</span>
          {endpoint.lastReceivedAt ? (
            <span className="text-xs text-fg-muted">
              {fmt.relative(new Date(endpoint.lastReceivedAt))}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Switch
          checked={endpoint.isEnabled}
          disabled={!canManage || update.isPending}
          aria-label={t(
            endpoint.isEnabled ? 'automation.disableEndpoint' : 'automation.enableEndpoint',
            { name: endpoint.name },
          )}
          onCheckedChange={(isEnabled) =>
            update.mutate(
              { id: endpoint.id, body: { isEnabled } },
              {
                onSuccess: () =>
                  toast.success(
                    t(isEnabled ? 'automation.endpointEnabled' : 'automation.endpointDisabled'),
                  ),
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
              <IconButton
                size="sm"
                label={t('automation.rotateSecretFor', { name: endpoint.name })}
                onClick={onRotate}
              >
                <KeyRound aria-hidden />
              </IconButton>
              <IconButton
                size="sm"
                label={t('automation.editEndpoint', { name: endpoint.name })}
                onClick={onEdit}
              >
                <Pencil aria-hidden />
              </IconButton>
              <IconButton
                size="sm"
                label={t('automation.deleteEndpoint2', { name: endpoint.name })}
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
