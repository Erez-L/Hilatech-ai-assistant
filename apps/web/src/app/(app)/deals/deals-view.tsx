'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FilterX, Handshake, KanbanSquare, List, Plus } from 'lucide-react';
import { Permission, type DealStatus, type DealWithRelations } from '@hilatech/contracts';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  EmptyState,
  ErrorState,
  Label,
  NativeSelect,
  PageHeader,
  Pagination,
  SearchInput,
  SegmentedControl,
  Skeleton,
  SortableHead,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  type SortState,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useDealBoard, useDeals, usePipelines } from '@/hooks/sales';
import { useCan } from '@/hooks/use-can';
import { orderedStages, visibleColumns } from '@/lib/deals';
import { PermissionGate } from '@/components/common/permission-gate';
import { ExportButton } from '@/components/data-exchange/export-button';
import { ImportButton } from '@/components/data-exchange/import-wizard';
import { CurrencyTotals, DealBoardView } from '@/components/deals/deal-board';
import { DealStatusBadge } from '@/components/deals/deal-badges';
import { DealDialog } from '@/components/deals/deal-dialog';
import { DealsTabs } from '@/components/deals/deals-tabs';
import { MoveDealMenu } from '@/components/deals/move-deal-menu';
import { useDealMove } from '@/components/deals/use-deal-move';
import { UserChip } from '@/components/crm/user-chip';
import { DEAL_STATUS_LABELS } from '@/lib/deals';
import { useFormat, useT } from '@/i18n/provider';

const PAGE_SIZE = 20;
type View = 'board' | 'list';
type SortKey = 'createdAt' | 'updatedAt' | 'value' | 'expectedCloseAt' | 'title';

export function DealsView() {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canCreate = useCan(Permission.DEALS_CREATE);
  const canUpdate = useCan(Permission.DEALS_UPDATE);

  const [view, setView] = React.useState<View>(
    searchParams.get('view') === 'list' ? 'list' : 'board',
  );
  const [pipelineId, setPipelineId] = React.useState(searchParams.get('pipelineId') ?? '');
  const [search, setSearch] = React.useState('');
  const [owner, setOwner] = React.useState<'' | 'me'>('');
  const [showClosed, setShowClosed] = React.useState(true);
  const [stageId, setStageId] = React.useState(searchParams.get('stageId') ?? '');
  const [status, setStatus] = React.useState<DealStatus | ''>('');
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState<SortState<SortKey>>({
    key: 'updatedAt',
    direction: 'desc',
  });
  const [createOpen, setCreateOpen] = React.useState(searchParams.get('new') === '1');

  const pipelines = usePipelines();
  const activePipeline =
    pipelines.data?.find((p) => p.id === pipelineId) ??
    pipelines.data?.find((p) => p.isDefault) ??
    pipelines.data?.[0];
  const activePipelineId = activePipeline?.id;

  const boardParams = {
    pipelineId: activePipelineId,
    ownerId: owner || undefined,
    search: search.trim() || undefined,
    includeClosed: true,
    limitPerColumn: 50,
  };
  const board = useDealBoard(boardParams, { enabled: view === 'board' && !!activePipelineId });
  const list = useDeals(
    {
      pipelineId: activePipelineId,
      stageId: stageId || undefined,
      status: status || undefined,
      ownerId: owner || undefined,
      search: search.trim() || undefined,
      page,
      pageSize: PAGE_SIZE,
      sortBy: sort.key,
      sortOrder: sort.direction,
    },
    { enabled: view === 'list' && !!activePipelineId },
  );
  const mover = useDealMove();

  const hasFilters = !!(search || owner || stageId || status);
  const reset = () => {
    setSearch('');
    setOwner('');
    setStageId('');
    setStatus('');
    setPage(1);
  };

  const onMove = (
    deal: DealWithRelations,
    stage: Parameters<typeof mover.request>[1],
    position?: number,
  ) => mover.request(deal, stage, position);

  const columns = board.data ? visibleColumns(board.data, showClosed) : [];
  const boardForView = board.data ? { ...board.data, columns } : null;

  return (
    <PermissionGate anyOf={[Permission.DEALS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('deals.deals')}
          description={t('deals.dealsDescription')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ImportButton entity="deals" />
              <ExportButton
                entity="deals"
                label={t('deals.deals')}
                filters={{
                  pipelineId: activePipelineId,
                  stageId: stageId || undefined,
                  status: status || undefined,
                  ownerId: owner || undefined,
                  search: search.trim() || undefined,
                  sortBy: sort.key,
                  sortOrder: sort.direction,
                }}
              />
              {canCreate ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={() => setCreateOpen(true)}>
                  {t('deals.newDeal')}
                </Button>
              ) : null}
            </div>
          }
        >
          <DealsTabs />
        </PageHeader>

        <Card>
          <CardContent className="flex flex-col gap-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1.4fr_1fr_auto_auto] xl:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deals-pipeline">{t('deals.pipeline')}</Label>
                <NativeSelect
                  id="deals-pipeline"
                  value={activePipelineId ?? ''}
                  disabled={!pipelines.data}
                  onChange={(e) => {
                    setPipelineId(e.target.value);
                    setStageId('');
                    setPage(1);
                  }}
                >
                  {(pipelines.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deals-search">{t('common.search')}</Label>
                <SearchInput
                  id="deals-search"
                  value={search}
                  onValueChange={(v) => {
                    setSearch(v);
                    setPage(1);
                  }}
                  placeholder={t('deals.searchDealsPlaceholder')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="deals-owner">{t('contacts.owner')}</Label>
                <NativeSelect
                  id="deals-owner"
                  value={owner}
                  onChange={(e) => {
                    setOwner(e.target.value as '' | 'me');
                    setPage(1);
                  }}
                >
                  <option value="">{t('common.anyone')}</option>
                  <option value="me">{t('deals.myDeals')}</option>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium" id="deals-view-label">
                  {t('deals.view')}
                </span>
                <SegmentedControl<View>
                  aria-label={t('deals.view')}
                  value={view}
                  onValueChange={(v) => {
                    setView(v);
                    setPage(1);
                  }}
                  options={[
                    {
                      value: 'board',
                      label: t('deals.boardView'),
                      icon: <KanbanSquare aria-hidden />,
                    },
                    { value: 'list', label: t('deals.listView'), icon: <List aria-hidden /> },
                  ]}
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
            {view === 'board' ? (
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="deals-show-closed"
                  checked={showClosed}
                  onCheckedChange={(c) => setShowClosed(c === true)}
                />
                <Label htmlFor="deals-show-closed" className="font-normal">
                  {t('deals.showWonAndLost')}
                </Label>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="deals-stage">{t('common.stage')}</Label>
                  <NativeSelect
                    id="deals-stage"
                    value={stageId}
                    onChange={(e) => {
                      setStageId(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">{t('leads.allStages')}</option>
                    {orderedStages(activePipeline?.stages ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="deals-status">{t('common.status')}</Label>
                  <NativeSelect
                    id="deals-status"
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value as DealStatus | '');
                      setPage(1);
                    }}
                  >
                    <option value="">{t('common.allStatuses')}</option>
                    {(['open', 'won', 'lost'] as const).map((s) => (
                      <option key={s} value={s}>
                        {t(DEAL_STATUS_LABELS[s])}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {pipelines.isError ? (
          <ErrorState
            title={t('common.thisCouldnTBeLoaded')}
            message={getErrorMessage(pipelines.error)}
            onRetry={() => void pipelines.refetch()}
          />
        ) : view === 'board' ? (
          <>
            {board.isPending || pipelines.isPending ? (
              <div className="flex gap-4 overflow-hidden" aria-busy>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-72 w-72 shrink-0 rounded-lg" />
                ))}
              </div>
            ) : board.isError ? (
              <ErrorState
                title={t('deals.boardCouldntBeLoaded')}
                message={getErrorMessage(board.error)}
                onRetry={() => void board.refetch()}
              />
            ) : boardForView ? (
              <>
                <section
                  aria-label={t('deals.pipelineTotals')}
                  className="flex flex-wrap items-start gap-x-8 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3"
                  data-testid="board-totals"
                >
                  <div className="flex flex-col">
                    <span className="text-xs text-fg-muted">{t('deals.openAndClosedDeals')}</span>
                    <span className="text-lg font-semibold tabular">
                      {board.data.columns.reduce((n, c) => n + c.count, 0)}
                    </span>
                  </div>
                  <div className="flex min-w-48 flex-col gap-1">
                    <span className="text-xs text-fg-muted">{t('deals.totalByCurrency')}</span>
                    <CurrencyTotals totals={board.data.totals} />
                  </div>
                  <p className="ms-auto max-w-xs text-xs text-fg-subtle">
                    {t('deals.totalsNeverMixed')}
                  </p>
                </section>
                {board.data.columns.every((c) => c.count === 0) ? (
                  <EmptyState
                    icon={<Handshake />}
                    title={hasFilters ? t('deals.noDealsMatchTheseFilters') : t('deals.noDealsYet')}
                    description={
                      hasFilters ? t('common.tryDifferentFilters') : t('deals.addYourFirstDeal')
                    }
                    action={
                      hasFilters ? (
                        <Button variant="secondary" onClick={reset}>
                          {t('common.clearFilters')}
                        </Button>
                      ) : canCreate ? (
                        <Button
                          leadingIcon={<Plus aria-hidden />}
                          onClick={() => setCreateOpen(true)}
                        >
                          {t('deals.newDeal')}
                        </Button>
                      ) : undefined
                    }
                  />
                ) : null}
                <DealBoardView
                  board={boardForView}
                  canMove={canUpdate}
                  onMove={onMove}
                  listHref={(sid) =>
                    `/deals?view=list&pipelineId=${board.data.pipeline.id}&stageId=${sid}`
                  }
                />
              </>
            ) : null}
          </>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      sortKey="title"
                      sort={sort}
                      onSortChange={(s) => {
                        setSort(s);
                        setPage(1);
                      }}
                    >
                      {t('deals.deal')}
                    </SortableHead>
                    <TableHead>{t('common.stage')}</TableHead>
                    <SortableHead
                      sortKey="value"
                      sort={sort}
                      onSortChange={(s) => {
                        setSort(s);
                        setPage(1);
                      }}
                    >
                      {t('common.value')}
                    </SortableHead>
                    <TableHead>{t('common.company')}</TableHead>
                    <TableHead>{t('contacts.owner')}</TableHead>
                    <SortableHead
                      sortKey="expectedCloseAt"
                      sort={sort}
                      onSortChange={(s) => {
                        setSort(s);
                        setPage(1);
                      }}
                    >
                      {t('deals.expectedClose')}
                    </SortableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">{t('common.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.isPending ? (
                    <TableSkeletonRows columns={8} rows={8} />
                  ) : list.isError ? (
                    <TableEmptyRow colSpan={8}>
                      <div className="flex flex-col items-center gap-2">
                        <span>{getErrorMessage(list.error)}</span>
                        <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
                          {t('common.tryAgain')}
                        </Button>
                      </div>
                    </TableEmptyRow>
                  ) : list.data.data.length === 0 ? (
                    <TableEmptyRow colSpan={8} className="py-4">
                      <EmptyState
                        compact
                        icon={<Handshake />}
                        title={
                          hasFilters ? t('deals.noDealsMatchTheseFilters') : t('deals.noDealsYet')
                        }
                        description={
                          hasFilters ? t('common.tryDifferentFilters') : t('deals.addYourFirstDeal')
                        }
                        action={
                          hasFilters ? (
                            <Button variant="secondary" size="sm" onClick={reset}>
                              {t('common.clearFilters')}
                            </Button>
                          ) : undefined
                        }
                      />
                    </TableEmptyRow>
                  ) : (
                    list.data.data.map((deal) => (
                      <TableRow
                        key={deal.id}
                        className="cursor-pointer"
                        data-testid="deal-row"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('a,button')) return;
                          router.push(`/deals/${deal.id}`);
                        }}
                      >
                        <TableCell>
                          <Link
                            href={`/deals/${deal.id}`}
                            dir="auto"
                            className="font-medium hover:underline"
                          >
                            {deal.title}
                          </Link>
                        </TableCell>
                        <TableCell dir="auto">{deal.stage.name}</TableCell>
                        <TableCell className="tabular whitespace-nowrap">
                          {deal.value != null ? (
                            fmt.currency(deal.value, deal.currency)
                          ) : (
                            <span className="text-fg-subtle">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-fg-muted" dir="auto">
                          {deal.company?.name ?? '—'}
                        </TableCell>
                        <TableCell>
                          <UserChip user={deal.owner} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-fg-muted tabular">
                          {deal.expectedCloseAt
                            ? fmt.date(new Date(deal.expectedCloseAt), 'short')
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <DealStatusBadge status={deal.status} />
                        </TableCell>
                        <TableCell>
                          {canUpdate && activePipeline ? (
                            <MoveDealMenu
                              dealTitle={deal.title}
                              stages={activePipeline.stages}
                              currentStageId={deal.stageId}
                              onMove={(stage) => mover.request(deal, stage)}
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {list.data && list.data.meta.total > PAGE_SIZE ? (
                <div className="border-t border-border px-5 py-3">
                  <Pagination
                    page={list.data.meta.page}
                    pageSize={list.data.meta.pageSize}
                    total={list.data.meta.total}
                    onPageChange={setPage}
                    itemLabel={t('deals.dealsLower')}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        {mover.dialog}
        <DealDialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open && searchParams.get('new')) router.replace('/deals');
          }}
          defaults={activePipelineId ? { pipelineId: activePipelineId, stageId: '' } : undefined}
        />
      </div>
    </PermissionGate>
  );
}
