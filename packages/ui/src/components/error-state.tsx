'use client';

import * as React from 'react';
import { CircleAlert, RotateCw } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { useUiStrings } from '../lib/ui-strings';

export interface ErrorStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  /** Plain-language explanation of what went wrong. */
  message?: React.ReactNode;
  /** Optional request id to quote to support. */
  requestId?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  compact?: boolean;
}

export function ErrorState({
  title,
  message,
  requestId,
  onRetry,
  retryLabel,
  retrying,
  compact = false,
  className,
  ...props
}: ErrorStateProps) {
  const ui = useUiStrings();
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact
          ? 'gap-2 px-4 py-8'
          : 'gap-3 rounded-lg border border-danger/30 bg-danger-soft/40 px-6 py-12',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-md bg-danger-soft text-danger',
          compact ? 'size-9 [&_svg]:size-4' : 'size-12 [&_svg]:size-5',
        )}
        aria-hidden
      >
        <CircleAlert />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className={cn('font-semibold text-fg', compact ? 'text-sm' : 'text-base')}>
          {title ?? ui.somethingWentWrong}
        </h3>
        <p className="text-sm text-fg-muted">{message ?? ui.loadFailed}</p>
        {requestId ? (
          <p className="font-mono text-2xs text-fg-subtle">{ui.request(requestId)}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          loading={retrying}
          leadingIcon={<RotateCw aria-hidden />}
          className="mt-1"
        >
          {retryLabel ?? ui.tryAgain}
        </Button>
      ) : null}
    </div>
  );
}
