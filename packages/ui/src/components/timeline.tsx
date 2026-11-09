import * as React from 'react';
import { cn } from '../lib/cn';

export type TimelineTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const toneClass: Record<TimelineTone, string> = {
  neutral: 'bg-surface-muted text-fg-muted',
  accent: 'bg-accent-soft text-accent-soft-fg',
  success: 'bg-success-soft text-success-soft-fg',
  warning: 'bg-warning-soft text-warning-soft-fg',
  danger: 'bg-danger-soft text-danger-soft-fg',
  info: 'bg-info-soft text-info-soft-fg',
};

export function Timeline({ className, ...props }: React.OlHTMLAttributes<HTMLOListElement>) {
  return <ol className={cn('relative flex flex-col', className)} {...props} />;
}

export interface TimelineItemProps extends Omit<React.LiHTMLAttributes<HTMLLIElement>, 'title'> {
  icon?: React.ReactNode;
  tone?: TimelineTone;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned timestamp or meta text. */
  meta?: React.ReactNode;
}

/** One event in a vertical timeline: marker + connector, title, optional description and meta. */
export function TimelineItem({
  icon,
  tone = 'neutral',
  title,
  description,
  meta,
  className,
  children,
  ...props
}: TimelineItemProps) {
  return (
    <li className={cn('group relative flex gap-3 pb-5 last:pb-0', className)} {...props}>
      <span
        aria-hidden
        className="absolute top-7 bottom-0 left-[0.8125rem] w-px bg-border group-last:hidden"
      />
      <span
        aria-hidden
        className={cn(
          'relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-surface [&_svg]:size-3.5',
          toneClass[tone],
        )}
      >
        {icon ?? <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-fg">{title}</p>
          {meta ? <span className="shrink-0 text-xs text-fg-subtle tabular">{meta}</span> : null}
        </div>
        {description ? <div className="text-sm text-fg-muted">{description}</div> : null}
        {children}
      </div>
    </li>
  );
}
