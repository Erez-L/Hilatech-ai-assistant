'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { BellRing } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Pagination,
  Skeleton,
} from '@hilatech/ui';
import { useBudgetAlerts } from '@/hooks/billing';
import { useCan } from '@/hooks/use-can';
import { QueryState } from '@/components/common/query-state';
import { ALERT_SCOPE_LABEL, formatAlertAmount } from '@/lib/billing';
import { DataTable } from '@/components/common/data-table';

const PAGE_SIZE = 10;

export function AlertsCard() {
  const canManage = useCan(Permission.ORG_BILLING_MANAGE);
  const [page, setPage] = React.useState(1);
  const query = useBudgetAlerts({ page, pageSize: PAGE_SIZE }, canManage);

  return (
    <Card role="region" aria-labelledby="alerts-title">
      <CardHeader>
        <CardTitle id="alerts-title">Budget alerts</CardTitle>
        <CardDescription>
          Warnings and exceeded notices, one per budget, level and month.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {!canManage ? (
          <EmptyState
            compact
            icon={<BellRing />}
            title="Alerts are restricted"
            description="Budget alerts are visible to members with the billing permission."
          />
        ) : (
          <QueryState
            query={query}
            compact
            errorTitle="Alerts couldn’t be loaded"
            loading={
              <div className="flex flex-col gap-3 p-5" aria-busy="true" aria-label="Loading alerts">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            }
            isEmpty={(r) => r.data.length === 0}
            empty={
              <EmptyState
                compact
                icon={<BellRing />}
                title="No budget alerts yet"
                description="An alert is created when a token or cost budget, or your plan’s AI allowance, reaches its warning threshold or is used up."
              />
            }
          >
            {(r) => (
              <div className="flex flex-col gap-3 pb-4">
                <DataTable
                  caption="Budget alerts"
                  rows={r.data}
                  rowKey={(a) => a.id}
                  columns={[
                    {
                      header: 'When',
                      render: (a) => (
                        <time dateTime={a.createdAt}>
                          {format(new Date(a.createdAt), 'd MMM yyyy, HH:mm')}
                        </time>
                      ),
                    },
                    { header: 'Budget', render: (a) => ALERT_SCOPE_LABEL[a.scope] },
                    {
                      header: 'Level',
                      render: (a) => (
                        <Badge variant={a.kind === 'exceeded' ? 'danger' : 'warning'} dot>
                          {a.kind === 'exceeded' ? 'Exceeded' : 'Warning'}
                        </Badge>
                      ),
                    },
                    {
                      header: 'Used / limit',
                      align: 'right',
                      render: (a) =>
                        `${formatAlertAmount(a.scope, a.used)} / ${formatAlertAmount(a.scope, a.limit)}`,
                    },
                    { header: 'Threshold', align: 'right', render: (a) => `${a.thresholdPct}%` },
                  ]}
                />
                {r.meta.totalPages > 1 ? (
                  <Pagination
                    className="px-5"
                    page={page}
                    pageSize={PAGE_SIZE}
                    total={r.meta.total}
                    itemLabel="alerts"
                    onPageChange={setPage}
                  />
                ) : null}
              </div>
            )}
          </QueryState>
        )}
      </CardContent>
    </Card>
  );
}
