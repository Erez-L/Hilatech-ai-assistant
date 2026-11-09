'use client';

import * as React from 'react';
import { CircleAlert, RotateCw } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';

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
  title = 'Something went wrong',
  message = 'The data could not be loaded. Check your connection and try again.',
  requestId,
  onRetry,
  retryLabel = 'Try again',
  retrying,
  compact = false,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 rounded-lg border border-danger/30 bg-danger-soft/40 px-6 py-12',
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
        <h3 className={cn('font-semibold text-fg', compact ? 'text-sm' : 'text-base')}>{title}</h3>
        {message ? <p className="text-sm text-fg-muted">{message}</p> : null}
        {requestId ? (
          <p className="font-mono text-2xs text-fg-subtle">Request {requestId}</p>
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
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
