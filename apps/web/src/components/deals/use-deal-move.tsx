'use client';

import * as React from 'react';
import type { DealWithRelations, PipelineStage } from '@hilatech/contracts';
import { toast } from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useMoveDeal } from '@/hooks/sales';
import { needsLostReason } from '@/lib/deals';
import { LostReasonDialog } from './lost-reason-dialog';
import { useT } from '@/i18n/provider';

interface Pending {
  deal: Pick<DealWithRelations, 'id' | 'title' | 'stageId' | 'stage'>;
  stage: PipelineStage;
  position?: number;
}

/**
 * Shared "move a deal" flow for the board, the list, the card menu and the detail page: moves to lost stages
 * ask for a reason first; the mutation is optimistic on the board and rolls back with a toast on failure.
 */
export function useDealMove() {
  const t = useT();
  const mutation = useMoveDeal();
  const [pending, setPending] = React.useState<Pending | null>(null);

  const run = React.useCallback(
    (deal: Pending['deal'], stage: PipelineStage, position?: number, lostReason?: string) => {
      mutation.mutate(
        { id: deal.id, body: { stageId: stage.id, position, lostReason } },
        {
          onSuccess: () => {
            setPending(null);
            toast.success(t('deals.dealMovedTo', { title: deal.title, stage: stage.name }));
          },
          onError: (error) => {
            setPending(null);
            toast.error(t('deals.moveFailed', { message: getErrorMessage(error) }));
          },
        },
      );
    },
    [mutation, t],
  );

  const request = React.useCallback(
    (deal: Pending['deal'], stage: PipelineStage, position?: number) => {
      if (deal.stageId === stage.id && position === undefined) return;
      if (needsLostReason(stage, deal.stage.kind)) {
        setPending({ deal, stage, position });
        return;
      }
      run(deal, stage, position);
    },
    [run],
  );

  const dialog = (
    <LostReasonDialog
      open={!!pending}
      dealTitle={pending?.deal.title ?? ''}
      stageName={pending?.stage.name ?? ''}
      pending={mutation.isPending}
      onCancel={() => setPending(null)}
      onConfirm={(reason) => pending && run(pending.deal, pending.stage, pending.position, reason)}
    />
  );

  return { request, dialog, isPending: mutation.isPending };
}
