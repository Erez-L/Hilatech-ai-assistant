import * as React from 'react';
import { cn } from '@hilatech/ui';

export function AuthCard({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </div>
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">{children}</div>
      {footer ? <div className="text-center text-sm text-fg-muted">{footer}</div> : null}
    </div>
  );
}
