import * as React from 'react';
import { cn } from '../lib/cn';

export interface LogoMarkProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
}

/**
 * Brand mark: a rounded tile holding an "h" whose ascender becomes a signal line —
 * the assistant listening and speaking for the business.
 */
export function LogoMark({ size = 28, className, ...props }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn('shrink-0', className)}
      {...props}
    >
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <path d="M10 24V8.5" stroke="var(--color-accent-fg)" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M10 16.5c1.6-2 3.6-3 5.6-3 3 0 5.4 2 5.4 5.4V24"
        stroke="var(--color-accent-fg)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 8.5h2.5M22 8.5h1.5"
        stroke="var(--color-accent-fg)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeOpacity="0.85"
      />
    </svg>
  );
}

export interface WordmarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  compact?: boolean;
}

export function Wordmark({ compact, className, ...props }: WordmarkProps) {
  return (
    <span className={cn('flex items-center gap-2.5 text-fg', className)} {...props}>
      <LogoMark size={compact ? 24 : 28} />
      <span className="flex flex-col leading-none">
        <span className={cn('font-semibold tracking-tight', compact ? 'text-sm' : 'text-[15px]')}>
          HilaTech
        </span>
        {compact ? null : <span className="mt-0.5 text-xs text-fg-muted">AI Assistant</span>}
      </span>
    </span>
  );
}
