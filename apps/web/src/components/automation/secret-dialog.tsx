'use client';

import * as React from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@hilatech/ui';
import { useT } from '@/i18n/provider';

/**
 * Shows a signing secret exactly once. The caller keeps the secret in state only while this dialog
 * is open; closing it discards the value so it can never be displayed again.
 */
export function SecretDialog({
  title,
  description,
  secret,
  children,
  onClose,
}: {
  title: string;
  description?: React.ReactNode;
  secret: string;
  /** Extra usage hints rendered under the secret. */
  children?: React.ReactNode;
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? t('automation.copyTheSecretNowAnd')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4 pb-2">
          <Alert tone="warning">
            <span className="flex items-center gap-1.5">
              <TriangleAlert className="size-4" aria-hidden />
              {t('automation.thisSecretIsShownOnly')}
            </span>
          </Alert>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="webhook-secret-value">{t('automation.signingSecret')}</Label>
            <div className="flex gap-2">
              <Input
                id="webhook-secret-value"
                aria-label={t('automation.signingSecret')}
                readOnly
                value={secret}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="secondary"
                leadingIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                onClick={() => void copy()}
              >
                {copied ? t('automation.copied') : t('automation.copySecret')}
              </Button>
            </div>
          </div>
          {copyError ? (
            <p role="alert" className="text-xs text-danger">
              {t('automation.copyingIsnTAvailableHere2')}
            </p>
          ) : null}
          {children}
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('automation.iVeSavedTheSecret')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
