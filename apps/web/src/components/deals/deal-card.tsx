'use client';

import * as React from 'react';
import Link from 'next/link';
import { Building2, CalendarClock, Contact } from 'lucide-react';
import type { DealWithRelations, PipelineStage } from '@hilatech/contracts';
import { Avatar, cn } from '@hilatech/ui';
import { contactName, fullName } from '@/lib/crm';
import { MoveDealMenu } from './move-deal-menu';
import { useFormat, useT } from '@/i18n/provider';

export interface DealCardProps {
  deal: DealWithRelations;
  stages: readonly PipelineStage[];
  canMove: boolean;
  dragging: boolean;
  onMove: (stage: PipelineStage) => void;
  onDragStart: (deal: DealWithRelations) => void;
  onDragEnd: () => void;
}

/** One card on the Kanban board. Draggable (mouse / touch-capable browsers) plus a "Move to…" menu for everyone else. */
export function DealCard({
  deal,
  stages,
  canMove,
  dragging,
  onMove,
  onDragStart,
  onDragEnd,
}: DealCardProps) {
  const t = useT();
  const fmt = useFormat();
  return (
    <li
      data-testid="deal-card"
      data-deal-id={deal.id}
      draggable={canMove}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', deal.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(deal);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'flex flex-col gap-2 rounded-md border border-border bg-surface p-3 shadow-xs',
        canMove && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/deals/${deal.id}`}
          dir="auto"
          className="min-w-0 text-sm font-medium break-words hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          draggable={false}
        >
          {deal.title}
        </Link>
        {canMove ? (
          <MoveDealMenu
            dealTitle={deal.title}
            stages={stages}
            currentStageId={deal.stageId}
            onMove={onMove}
          />
        ) : null}
      </div>
      <p className="text-sm font-semibold tabular">
        {deal.value != null ? (
          fmt.currency(deal.value, deal.currency)
        ) : (
          <span className="font-normal text-fg-subtle">{t('deals.noValue')}</span>
        )}
      </p>
      {deal.company || deal.contact ? (
        <div className="flex flex-col gap-0.5 text-xs text-fg-muted">
          {deal.company ? (
            <span className="flex items-center gap-1.5 truncate" dir="auto">
              <Building2 className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{deal.company.name}</span>
            </span>
          ) : null}
          {deal.contact ? (
            <span className="flex items-center gap-1.5 truncate" dir="auto">
              <Contact className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{contactName(deal.contact)}</span>
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
        {deal.expectedCloseAt ? (
          <span className="inline-flex items-center gap-1" title={t('deals.expectedClose')}>
            <CalendarClock className="size-3" aria-hidden />
            <time dateTime={deal.expectedCloseAt}>
              {fmt.date(new Date(deal.expectedCloseAt), 'short')}
            </time>
          </span>
        ) : (
          <span />
        )}
        {deal.owner ? (
          <Avatar
            size="xs"
            src={deal.owner.avatarUrl}
            firstName={deal.owner.firstName}
            lastName={deal.owner.lastName}
            title={fullName(deal.owner)}
          />
        ) : null}
      </div>
    </li>
  );
}
