'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight, FilterX, ScrollText } from 'lucide-react';
import { AuditAction, Permission, type AuditLog } from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  IconButton,
  Input,
  Label,
  NativeSelect,
  PageHeader,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  cn,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useAuditLogs, useMembers } from '@/hooks/queries';
import { enumLabel } from '@/i18n/enums';
import { auditTone, describeAuditAction, describeAuditTarget } from '@/lib/audit-labels';
import { PermissionGate } from '@/components/common/permission-gate';
import { useT, useFormat } from '@/i18n/provider';

const PAGE_SIZE = 25;

const ACTION_GROUPS = Array.from(
  new Set(Object.values(AuditAction).map((a) => a.split('.')[0] as string)),
);

export function AuditView() {
  const t = useT();
  const [page, setPage] = React.useState(1);
  const [action, setAction] = React.useState('');
  const [actor, setActor] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  const query = useAuditLogs({
    page,
    pageSize: PAGE_SIZE,
    action: action || undefined,
    actorUserId: actor || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  });
  const members = useMembers({ page: 1, pageSize: 100 });

  const hasFilters = !!(action || actor || from || to);
  const reset = () => {
    setAction('');
    setActor('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const actorName = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members.data?.data ?? [])
      map.set(m.userId, `${m.user.firstName} ${m.user.lastName}`.trim());
    return (id: string | null) =>
      id ? (map.get(id) ?? t('audit.formerMember')) : t('audit.system');
  }, [members.data, t]);

  return (
    <PermissionGate anyOf={[Permission.AUDIT_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('common.auditLog')}
          description={t('audit.aPermanentRecordOfSensitive')}
        />

        <Card>
          <CardContent className="flex flex-col gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audit-action">{t('audit.action')}</Label>
                <NativeSelect
                  id="audit-action"
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('audit.allActions')}</option>
                  {ACTION_GROUPS.map((group) => (
                    <optgroup key={group} label={group}>
                      {Object.values(AuditAction)
                        .filter((a) => a.startsWith(`${group}.`))
                        .map((a) => (
                          <option key={a} value={a}>
                            {describeAuditAction(a, t)}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audit-actor">{t('audit.actor')}</Label>
                <NativeSelect
                  id="audit-actor"
                  value={actor}
                  onChange={(e) => {
                    setActor(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">{t('common.anyone')}</option>
                  {(members.data?.data ?? []).map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user.firstName} {m.user.lastName}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audit-from">{t('common.from')}</Label>
                <Input
                  id="audit-from"
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="audit-to">{t('audit.to')}</Label>
                <Input
                  id="audit-to"
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <Button
                variant="ghost"
                onClick={reset}
                disabled={!hasFilters}
                leadingIcon={<FilterX aria-hidden />}
              >
                {t('common.clear')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <AuditTable
              query={query}
              actorName={actorName}
              hasFilters={hasFilters}
              onClear={reset}
            />
            {query.data && query.data.meta.total > PAGE_SIZE ? (
              <div className="border-t border-border px-5 py-3">
                <Pagination
                  page={query.data.meta.page}
                  pageSize={query.data.meta.pageSize}
                  total={query.data.meta.total}
                  onPageChange={setPage}
                  itemLabel="entries"
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </PermissionGate>
  );
}

function AuditTable({
  query,
  actorName,
  hasFilters,
  onClear,
}: {
  query: ReturnType<typeof useAuditLogs>;
  actorName: (id: string | null) => string;
  hasFilters: boolean;
  onClear: () => void;
}) {
  const t = useT();
  const columns = 5;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">
            <span className="sr-only">{t('common.details')}</span>
          </TableHead>
          <TableHead>{t('common.when')}</TableHead>
          <TableHead>{t('audit.action')}</TableHead>
          <TableHead>{t('audit.actor')}</TableHead>
          <TableHead>{t('audit.target')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.isPending ? (
          <TableSkeletonRows columns={columns} rows={8} />
        ) : query.isError ? (
          <TableEmptyRow colSpan={columns}>
            <div className="flex flex-col items-center gap-2">
              <span>{getErrorMessage(query.error)}</span>
              <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                {t('common.tryAgain')}
              </Button>
            </div>
          </TableEmptyRow>
        ) : query.data.data.length === 0 ? (
          <TableEmptyRow colSpan={columns} className="py-4">
            <EmptyState
              compact
              icon={<ScrollText />}
              title={
                hasFilters
                  ? t('audit.nothingMatchesTheseFilters')
                  : t('audit.noActivityRecordedYet')
              }
              description={
                hasFilters
                  ? t('audit.widenTheDateRangeOr')
                  : t('audit.signInsInvitationsRoleChanges')
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={onClear}>
                    {t('common.clearFilters')}
                  </Button>
                ) : undefined
              }
            />
          </TableEmptyRow>
        ) : (
          query.data.data.map((log) => (
            <AuditRow key={log.id} log={log} actorName={actorName(log.actorUserId)} />
          ))
        )}
      </TableBody>
    </Table>
  );
}

function AuditRow({ log, actorName }: { log: AuditLog; actorName: string }) {
  const fmt = useFormat();
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const hasMeta = Object.keys(log.metadata ?? {}).length > 0;
  const detailsId = `audit-${log.id}`;
  return (
    <>
      <TableRow className={cn(open && 'bg-surface-muted/40')}>
        <TableCell className="pe-0">
          <IconButton
            label={open ? t('common.hideDetails') : t('common.showDetails')}
            size="sm"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          </IconButton>
        </TableCell>
        <TableCell className="whitespace-nowrap text-fg-muted tabular">
          <time dateTime={log.createdAt} title={fmt.dateTime(new Date(log.createdAt), 'long')}>
            {fmt.relative(new Date(log.createdAt))}
          </time>
        </TableCell>
        <TableCell>
          <span className="flex items-center gap-2">
            <Badge variant={auditTone(log.action)} dot>
              {enumLabel(t, 'audit.target', log.action.split('.')[0] ?? '')}
            </Badge>
            <span className="font-medium">{describeAuditAction(log.action, t)}</span>
          </span>
        </TableCell>
        <TableCell>{actorName}</TableCell>
        <TableCell className="text-fg-muted">{describeAuditTarget(log, t) ?? '—'}</TableCell>
      </TableRow>
      {open ? (
        <tr id={detailsId} className="border-b border-border bg-surface-muted/40">
          <td />
          <td colSpan={4} className="px-3 pt-0 pb-4">
            <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-[auto_1fr]">
              <dt className="text-fg-muted">{t('audit.actionKey')}</dt>
              <dd className="font-mono">{log.action}</dd>
              <dt className="text-fg-muted">{t('audit.timestamp')}</dt>
              <dd className="tabular">{fmt.dateTime(new Date(log.createdAt), 'long')}</dd>
              {log.targetType ? (
                <>
                  <dt className="text-fg-muted">{t('audit.target')}</dt>
                  <dd className="font-mono">
                    {log.targetType}
                    {log.targetId ? ` · ${log.targetId}` : ''}
                  </dd>
                </>
              ) : null}
              <dt className="text-fg-muted">{t('audit.ipAddress')}</dt>
              <dd className="font-mono">{log.ipAddress ?? '—'}</dd>
              <dt className="text-fg-muted">{t('audit.userAgent')}</dt>
              <dd className="break-all">{log.userAgent ?? '—'}</dd>
              <dt className="text-fg-muted">{t('audit.requestId')}</dt>
              <dd className="font-mono">{log.requestId ?? '—'}</dd>
              {hasMeta ? (
                <>
                  <dt className="text-fg-muted">{t('audit.metadata')}</dt>
                  <dd>
                    <pre className="max-h-48 overflow-auto rounded-sm border border-border bg-surface p-2 font-mono text-2xs leading-relaxed scrollbar-thin">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </dd>
                </>
              ) : null}
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}
