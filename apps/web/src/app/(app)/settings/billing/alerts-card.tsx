'use client';

import * as React from 'react';
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
import { useT, useFormat } from '@/i18n/provider';

const PAGE_SIZE = 10;

export function AlertsCard() {
  const fmt = useFormat();
  const t = useT();
  const canManage = useCan(Permission.ORG_BILLING_MANAGE);
  const [page, setPage] = React.useState(1);
  const query = useBudgetAlerts({ page, pageSize: PAGE_SIZE }, canManage);

  return (
    <Card role="region" aria-labelledby="alerts-title">
      <CardHeader>
        <CardTitle id="alerts-title">{t('settings.budgetAlerts')}</CardTitle>
        <CardDescription>{t('settings.warningsAndExceededNoticesOne')}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {!canManage ? (
          <EmptyState
            compact
            icon={<BellRing />}
            title={t('settings.alertsAreRestricted')}
            description={t('settings.budgetAlertsAreVisibleTo')}
          />
        ) : (
          <QueryState
            query={query}
            compact
            errorTitle={t('settings.alertsCouldnTBeLoaded')}
            loading={
              <div
                className="flex flex-col gap-3 p-5"
                aria-busy="true"
                aria-label={t('settings.loadingAlerts')}
              >
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
                title={t('settings.noBudgetAlertsYet')}
                description={t('settings.anAlertIsCreatedWhen')}
              />
            }
          >
            {(r) => (
              <div className="flex flex-col gap-3 pb-4">
                <DataTable
                  caption={t('settings.budgetAlerts')}
                  rows={r.data}
                  rowKey={(a) => a.id}
                  columns={[
                    {
                      header: t('common.when'),
                      render: (a) => (
                        <time dateTime={a.createdAt}>{fmt.dateTime(new Date(a.createdAt))}</time>
                      ),
                    },
                    { header: t('settings.budget'), render: (a) => t(ALERT_SCOPE_LABEL[a.scope]) },
                    {
                      header: t('settings.level'),
                      render: (a) => (
                        <Badge variant={a.kind === 'exceeded' ? 'danger' : 'warning'} dot>
                          {a.kind === 'exceeded' ? t('common.exceeded') : t('common.warning')}
                        </Badge>
                      ),
                    },
                    {
                      header: t('settings.usedLimit'),
                      align: 'right',
                      render: (a) =>
                        `${formatAlertAmount(a.scope, a.used, fmt)} / ${formatAlertAmount(a.scope, a.limit, fmt)}`,
                    },
                    {
                      header: t('settings.threshold'),
                      align: 'right',
                      render: (a) => `${a.thresholdPct}%`,
                    },
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
