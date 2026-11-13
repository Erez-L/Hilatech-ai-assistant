import * as React from 'react';
import { cn } from '../lib/cn';

export interface FormSectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  /** One sentence on what this group of fields is for. */
  description?: React.ReactNode;
  /** Actions that belong to the section (kept at the end of the heading row). */
  actions?: React.ReactNode;
}

/** A titled group of form fields: heading and description first, then the fields with one consistent gap. */
export function FormSection({
  title,
  description,
  actions,
  className,
  children,
  ...props
}: FormSectionProps) {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn('flex flex-col gap-4', className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id={headingId} className="text-base font-semibold text-fg">
            {title}
          </h3>
          {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
