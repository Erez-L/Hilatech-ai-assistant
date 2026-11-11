'use client';

import * as React from 'react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Textarea,
} from '@hilatech/ui';
import { useT } from '@/i18n/provider';

/** Asks why a deal is being closed as lost (optional, max 500 characters; stored as `lostReason`). */
export function LostReasonDialog({
  open,
  dealTitle,
  stageName,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  dealTitle: string;
  stageName: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | undefined) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent size="md">
        <LostReasonForm dealTitle={dealTitle} stageName={stageName} pending={pending} onCancel={onCancel} onConfirm={onConfirm} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so the reason starts empty every time. */
function LostReasonForm({
  dealTitle,
  stageName,
  pending,
  onCancel,
  onConfirm,
}: {
  dealTitle: string;
  stageName: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | undefined) => void;
}) {
  const t = useT();
  const [reason, setReason] = React.useState('');
  return (
    <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(reason.trim() || undefined);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('deals.markAsLost')}</DialogTitle>
            <DialogDescription>{t('deals.markAsLostDescription', { title: dealTitle, stage: stageName })}</DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-2">
            <FormField id="deal-lost-reason" label={t('deals.lostReason')} description={t('deals.lostReasonHint')}>
              <Textarea
                autoFocus
                rows={3}
                dir="auto"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" loading={pending}>
              {t('deals.markAsLost')}
            </Button>
          </DialogFooter>
    </form>
  );
}
