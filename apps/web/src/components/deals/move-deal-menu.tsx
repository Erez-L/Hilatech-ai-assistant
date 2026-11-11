'use client';

import * as React from 'react';
import { ArrowRightLeft, Check } from 'lucide-react';
import type { PipelineStage } from '@hilatech/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Button,
} from '@hilatech/ui';
import { orderedStages } from '@/lib/deals';
import { useT } from '@/i18n/provider';

/**
 * The keyboard- and screen-reader-friendly alternative to dragging: a "Move to…" menu listing the stages
 * of the deal's pipeline.
 */
export function MoveDealMenu({
  dealTitle,
  stages,
  currentStageId,
  onMove,
  variant = 'icon',
  disabled,
}: {
  dealTitle: string;
  stages: readonly PipelineStage[];
  currentStageId: string;
  onMove: (stage: PipelineStage) => void;
  variant?: 'icon' | 'button';
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'button' ? (
          <Button variant="secondary" leadingIcon={<ArrowRightLeft aria-hidden />} disabled={disabled}>
            {t('deals.moveTo')}
          </Button>
        ) : (
          <IconButton size="sm" label={t('deals.moveDealTo', { title: dealTitle })} disabled={disabled}>
            <ArrowRightLeft aria-hidden />
          </IconButton>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>{t('deals.moveTo')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orderedStages(stages).map((stage) => (
          <DropdownMenuItem
            key={stage.id}
            disabled={stage.id === currentStageId}
            onSelect={() => onMove(stage)}
          >
            <span className="flex flex-1 items-center gap-2">
              <span dir="auto">{stage.name}</span>
            </span>
            {stage.id === currentStageId ? <Check className="size-3.5" aria-label={t('deals.currentStage')} /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
