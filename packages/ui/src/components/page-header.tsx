import * as React from 'react';
import { cn } from '../lib/cn';

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned actions (buttons). */
  actions?: React.ReactNode;
  /** Optional breadcrumb or eyebrow rendered above the title. */
  breadcrumb?: React.ReactNode;
  /** Optional element rendered beneath the header (tabs, filters). */
  children?: React.ReactNode;
}

export function PageHeader({ title, description, actions, breadcrumb, children, className, ...props }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4', className)} {...props}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          {breadcrumb ? <div className="text-xs text-fg-muted">{breadcrumb}</div> : null}
          <h1 className="text-2xl leading-tight font-semibold tracking-tight text-fg">{title}</h1>
          {description ? <p className="max-w-2xl text-sm text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

export function SectionHeader({ title, description, actions, className, ...props }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between', className)} {...props}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-base leading-tight font-semibold text-fg">{title}</h2>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
