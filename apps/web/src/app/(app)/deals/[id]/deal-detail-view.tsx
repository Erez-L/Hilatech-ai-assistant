'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRightLeft,
  Coins,
  History,
  Pencil,
  RotateCcw,
  Sparkles,
  StickyNote,
  Trash2,
  Trophy,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';
import {
  Permission,
  type DealActivityWithActor,
  type DealWithRelations,
} from '@hilatech/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Skeleton,
  Timeline,
  TimelineItem,
  cn,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useDeal, useDealActivities, useDeleteDeal, usePipelines } from '@/hooks/sales';
import { useCan } from '@/hooks/use-can';
import { contactName } from '@/lib/crm';
import { describeDealActivity, orderedStages } from '@/lib/deals';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { UserChip } from '@/components/crm/user-chip';
import { DealStatusBadge } from '@/components/deals/deal-badges';
import { DealDialog } from '@/components/deals/deal-dialog';
import { DealNotes } from '@/components/deals/deal-notes';
import { MoveDealMenu } from '@/components/deals/move-deal-menu';
import { useDealMove } from '@/components/deals/use-deal-move';
import { TaskPanel } from '@/components/tasks/task-panel';
import { useFormat, useT } from '@/i18n/provider';

export function DealDetailView({ id }: { id: string }) {
  const t = useT();
  const deal = useDeal(id);
  return (
    <PermissionGate anyOf={[Permission.DEALS_READ]}>
      <QueryState
        query={deal}
        loading={
          <div className="flex flex-col gap-6" aria-busy>
            <Skeleton className="h-8 w-80" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
              <Skeleton className="h-72 rounded-lg" />
              <Skeleton className="h-56 rounded-lg" />
            </div>
          </div>
        }
        errorTitle={t('deals.thisDealCouldntBeLoaded')}
      >
        {(data) => <DealBody deal={data} />}
      </QueryState>
      {deal.isError && isApiError(deal.error) && deal.error.isNotFound ? (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary" leadingIcon={<ArrowLeft aria-hidden />}>
            <Link href="/deals">{t('deals.backToDeals')}</Link>
          </Button>
        </div>
      ) : null}
    </PermissionGate>
  );
}

const ACTIVITY_ICONS: Record<DealActivityWithActor['type'], React.ReactNode> = {
  created: <Sparkles aria-hidden />,
  stage_changed: <ArrowRightLeft aria-hidden />,
  won: <Trophy aria-hidden />,
  lost: <XCircle aria-hidden />,
  reopened: <RotateCcw aria-hidden />,
  value_changed: <Coins aria-hidden />,
  owner_changed: <UserRoundCheck aria-hidden />,
  note_added: <StickyNote aria-hidden />,
  updated: <Pencil aria-hidden />,
};

function DealBody({ deal }: { deal: DealWithRelations }) {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const canUpdate = useCan(Permission.DEALS_UPDATE);
  const canDelete = useCan(Permission.DEALS_DELETE);
  const pipelines = usePipelines();
  const pipeline = pipelines.data?.find((p) => p.id === deal.pipelineId);
  const stages = React.useMemo(() => orderedStages(pipeline?.stages ?? []), [pipeline]);
  const mover = useDealMove();
  const remove = useDeleteDeal();
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/deals" className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-3.5" aria-hidden />
            {t('deals.deals')}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span dir="auto">{deal.title}</span>
            <DealStatusBadge status={deal.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium text-fg tabular">
              {deal.value != null ? fmt.currency(deal.value, deal.currency) : t('deals.noValue')}
            </span>
            {pipeline ? <span dir="auto">{pipeline.name}</span> : null}
          </span>
        }
        actions={
          <>
            {canUpdate && stages.length > 0 ? (
              <MoveDealMenu
                variant="button"
                dealTitle={deal.title}
                stages={stages}
                currentStageId={deal.stageId}
                onMove={(stage) => mover.request(deal, stage)}
                disabled={mover.isPending}
              />
            ) : null}
            {canUpdate ? (
              <Button
                variant="secondary"
                leadingIcon={<Pencil aria-hidden />}
                onClick={() => setEditOpen(true)}
              >
                {t('common.edit')}
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                variant="secondary"
                leadingIcon={<Trash2 aria-hidden />}
                onClick={() => setDeleteOpen(true)}
              >
                {t('common.delete')}
              </Button>
            ) : null}
          </>
        }
      />

      {stages.length > 0 ? (
        <Card>
          <CardContent className="py-4">
            <ol
              aria-label={t('deals.stageProgress')}
              className="flex flex-wrap items-center gap-2"
              data-testid="stage-track"
            >
              {stages.map((s) => {
                const current = s.id === deal.stageId;
                return (
                  <li
                    key={s.id}
                    aria-current={current ? 'step' : undefined}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm',
                      current
                        ? s.kind === 'won'
                          ? 'border-success bg-success-soft font-semibold text-success-soft-fg'
                          : s.kind === 'lost'
                            ? 'border-danger bg-danger-soft font-semibold text-danger-soft-fg'
                            : 'border-accent bg-accent-soft font-semibold text-accent-soft-fg'
                        : 'border-border text-fg-muted',
                    )}
                    dir="auto"
                  >
                    {s.name}
                  </li>
                );
              })}
            </ol>
            {deal.status === 'lost' && deal.lostReason ? (
              <p className="mt-3 text-sm text-fg-muted" dir="auto">
                <span className="font-medium text-fg">{t('deals.lostReason')}</span>{' '}
                {deal.lostReason}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          {deal.description ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('common.description')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap" dir="auto">
                  {deal.description}
                </p>
              </CardContent>
            </Card>
          ) : null}
          <DealNotes dealId={deal.id} canWrite={canUpdate} />
          <TaskPanel
            relationKey="dealId"
            recordId={deal.id}
            idPrefix="deal"
            relation={{ deal: deal.title }}
          />
          <DealActivity dealId={deal.id} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('leads.summary')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt className="text-fg-muted">{t('common.stage')}</dt>
                <dd dir="auto">{deal.stage.name}</dd>
                <dt className="text-fg-muted">{t('deals.probability')}</dt>
                <dd className="tabular">
                  {t('deals.probabilityValue', { value: deal.stage.probability })}
                </dd>
                <dt className="text-fg-muted">{t('contacts.owner')}</dt>
                <dd>
                  <UserChip user={deal.owner} emptyLabel={t('contacts.noOwner')} />
                </dd>
                <dt className="text-fg-muted">{t('common.company')}</dt>
                <dd>
                  {deal.company ? (
                    <Link
                      href={`/companies/${deal.company.id}`}
                      dir="auto"
                      className="hover:underline"
                    >
                      {deal.company.name}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt className="text-fg-muted">{t('common.contact')}</dt>
                <dd>
                  {deal.contact ? (
                    <Link
                      href={`/contacts/${deal.contact.id}`}
                      dir="auto"
                      className="hover:underline"
                    >
                      {contactName(deal.contact)}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt className="text-fg-muted">{t('deals.expectedClose')}</dt>
                <dd>{deal.expectedCloseAt ? fmt.date(new Date(deal.expectedCloseAt)) : '—'}</dd>
                {deal.closedAt ? (
                  <>
                    <dt className="text-fg-muted">{t('deals.closed')}</dt>
                    <dd>{fmt.date(new Date(deal.closedAt))}</dd>
                  </>
                ) : null}
                <dt className="text-fg-muted">{t('common.tags')}</dt>
                <dd className="flex flex-wrap gap-1">
                  {deal.tags.length > 0 ? (
                    deal.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </dd>
                <dt className="text-fg-muted">{t('deals.inStageSince')}</dt>
                <dd className="tabular">{fmt.relative(new Date(deal.stageEnteredAt))}</dd>
                <dt className="text-fg-muted">{t('contacts.added')}</dt>
                <dd>{fmt.date(new Date(deal.createdAt))}</dd>
              </dl>
            </CardContent>
          </Card>
          <StageHistory dealId={deal.id} />
        </div>
      </div>

      {mover.dialog}
      <DealDialog open={editOpen} onOpenChange={setEditOpen} deal={deal} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('deals.deleteDealTitle', { title: deal.title })}
        description={t('deals.deleteDealBody')}
        confirmLabel={t('deals.deleteDeal')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(deal.id, {
            onSuccess: () => {
              toast.success(t('deals.dealDeleted', { title: deal.title }));
              router.replace('/deals');
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}

function ActivityTimeline({ items }: { items: DealActivityWithActor[] }) {
  const t = useT();
  const fmt = useFormat();
  return (
    <Timeline aria-label={t('deals.dealActivity')}>
      {items.map((a) => {
        const d = describeDealActivity(a, t, fmt);
        return (
          <TimelineItem
            key={a.id}
            icon={ACTIVITY_ICONS[a.type]}
            tone={d.tone}
            title={d.title}
            description={d.description}
            meta={
              <time dateTime={a.createdAt} title={fmt.dateTime(new Date(a.createdAt), 'long')}>
                {fmt.relative(new Date(a.createdAt))}
              </time>
            }
          />
        );
      })}
    </Timeline>
  );
}

function DealActivity({ dealId }: { dealId: string }) {
  const t = useT();
  const activities = useDealActivities(dealId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('leads.activity')}</CardTitle>
        <CardDescription>{t('deals.activityDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={activities}
          compact
          loading={<Skeleton className="h-24 w-full" />}
          isEmpty={(r) => r.data.length === 0}
          empty={<EmptyState compact icon={<History />} title={t('leads.noActivityRecorded')} />}
        >
          {(r) => <ActivityTimeline items={r.data} />}
        </QueryState>
      </CardContent>
    </Card>
  );
}

/** Only the stage movements: created, moved, won, lost, reopened. */
function StageHistory({ dealId }: { dealId: string }) {
  const t = useT();
  const activities = useDealActivities(dealId);
  return (
    <Card data-testid="stage-history">
      <CardHeader>
        <CardTitle>{t('deals.stageHistory')}</CardTitle>
        <CardDescription>{t('deals.stageHistoryDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={activities}
          compact
          loading={<Skeleton className="h-24 w-full" />}
          isEmpty={(r) => r.data.filter(isStageEvent).length === 0}
          empty={<EmptyState compact icon={<History />} title={t('deals.noStageChanges')} />}
        >
          {(r) => <ActivityTimeline items={r.data.filter(isStageEvent)} />}
        </QueryState>
      </CardContent>
    </Card>
  );
}

const STAGE_EVENT_TYPES = new Set(['created', 'stage_changed', 'won', 'lost', 'reopened']);
const isStageEvent = (a: DealActivityWithActor) => STAGE_EVENT_TYPES.has(a.type);
