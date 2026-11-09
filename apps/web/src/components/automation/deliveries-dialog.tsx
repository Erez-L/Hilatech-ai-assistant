'use client';

import * as React from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Webhook } from '@hilatech/contracts';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  NativeSelect,
  Pagination,
  StatusBadge,
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
import { useTestWebhook, useWebhookDeliveries } from '@/hooks/automation';
import { useCan } from '@/hooks/use-can';
import { Permission } from '@hilatech/contracts';

type DeliveryStatus = 'pending' | 'delivered' | 'failed';

/** Delivery attempts of a subscription (newest first); polls while any delivery is pending. */
export function DeliveriesDialog({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const canManage = useCan(Permission.AUTOMATIONS_MANAGE);
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<DeliveryStatus | ''>('');
  const deliveries = useWebhookDeliveries(webhook.id, { page, status: status || undefined });
  const test = useTestWebhook();
  const columns = 6;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Deliveries — {webhook.url}</DialogTitle>
          <DialogDescription>
            Every attempt to deliver an event to this endpoint, newest first.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-44">
              <NativeSelect
                aria-label="Filter deliveries by status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as DeliveryStatus | '');
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="delivered">Delivered</option>
                <option value="failed">Failed</option>
              </NativeSelect>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<RefreshCw aria-hidden />}
              loading={deliveries.isFetching}
              onClick={() => void deliveries.refetch()}
            >
              Refresh
            </Button>
            {canManage ? (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Send aria-hidden />}
                loading={test.isPending}
                onClick={() =>
                  test.mutate(webhook.id, {
                    onSuccess: () => toast.success('Test delivery queued'),
                    onError: (e) => toast.error(getErrorMessage(e)),
                  })
                }
              >
                Send test delivery
              </Button>
            ) : null}
          </div>
          <Table aria-label="Deliveries">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead className="text-right">Response</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.isPending ? (
                <TableSkeletonRows columns={columns} rows={3} />
              ) : deliveries.isError ? (
                <TableEmptyRow colSpan={columns}>
                  <div className="flex flex-col items-center gap-2">
                    <span>{getErrorMessage(deliveries.error)}</span>
                    <Button variant="secondary" size="sm" onClick={() => void deliveries.refetch()}>
                      Try again
                    </Button>
                  </div>
                </TableEmptyRow>
              ) : deliveries.data.data.length === 0 ? (
                <TableEmptyRow colSpan={columns} className="py-4">
                  <EmptyState
                    compact
                    title="No deliveries yet"
                    description="Send a test delivery, or wait for one of the subscribed events."
                  />
                </TableEmptyRow>
              ) : (
                deliveries.data.data.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{d.event}</TableCell>
                    <TableCell>
                      <StatusBadge
                        status={d.status}
                        tone={
                          d.status === 'delivered'
                            ? 'success'
                            : d.status === 'failed'
                              ? 'danger'
                              : 'warning'
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right tabular">{d.attempts}</TableCell>
                    <TableCell className="text-right tabular">{d.responseStatus ?? '—'}</TableCell>
                    <TableCell className="max-w-xs text-xs break-words text-danger">
                      {d.lastError ?? ''}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {deliveries.data && deliveries.data.meta.total > deliveries.data.meta.pageSize ? (
            <Pagination
              page={deliveries.data.meta.page}
              pageSize={deliveries.data.meta.pageSize}
              total={deliveries.data.meta.total}
              onPageChange={setPage}
              itemLabel="deliveries"
            />
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
