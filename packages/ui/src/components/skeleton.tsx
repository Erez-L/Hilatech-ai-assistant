import * as React from 'react';
import { cn } from '../lib/cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'rounded-sm bg-[linear-gradient(90deg,var(--color-surface-muted)_25%,var(--color-border)_50%,var(--color-surface-muted)_75%)] bg-[length:200%_100%] animate-shimmer',
        className,
      )}
      {...props}
    />
  );
}

/** A block of text-like skeleton lines. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
