import * as React from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Compact variant for use inside tables and cards. */
  compact?: boolean;
}

/** An empty screen is an invitation to act: say what belongs here and how to add it. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact
          ? 'gap-2 px-4 py-8'
          : 'gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-14',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          className={cn(
            'flex items-center justify-center rounded-lg bg-tone-soft text-tone-fg',
            compact ? 'size-9 [&_svg]:size-4' : 'size-14 animate-rise [&_svg]:size-6',
          )}
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className={cn('font-semibold text-fg', compact ? 'text-sm' : 'text-base')}>{title}</h3>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
