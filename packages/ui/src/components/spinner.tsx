import * as React from 'react';
import { cn } from '../lib/cn';

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export function Spinner({ size = 'md', label = 'Loading', className, ...props }: SpinnerProps) {
  const dim = size === 'sm' ? 'size-4' : size === 'lg' ? 'size-8' : 'size-5';
  return (
    <svg
      role="status"
      aria-label={label}
      viewBox="0 0 24 24"
      fill="none"
      className={cn('animate-spin text-accent', dim, className)}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Centered spinner for whole-page or whole-card loading. */
export function LoadingBlock({
  label = 'Loading',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-40 items-center justify-center', className)}>
      <Spinner label={label} />
    </div>
  );
}
