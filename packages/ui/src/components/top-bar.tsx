import * as React from 'react';
import { cn } from '../lib/cn';

export interface TopBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Left slot: menu toggle, breadcrumbs, page context. */
  start?: React.ReactNode;
  /** Right slot: search, notifications, theme, user menu. */
  end?: React.ReactNode;
}

export function TopBar({ start, end, className, children, ...props }: TopBarProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-bg/70 sm:px-6',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2">{start}</div>
      {children}
      <div className="flex items-center gap-1.5">{end}</div>
    </div>
  );
}
