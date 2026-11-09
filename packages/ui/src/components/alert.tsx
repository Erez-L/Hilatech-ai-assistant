import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { CheckCircle2, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/cn';

const alertVariants = cva(
  'flex gap-3 rounded-md border px-3.5 py-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        info: 'border-info/30 bg-info-soft text-info-soft-fg [&_svg]:text-info',
        success: 'border-success/30 bg-success-soft text-success-soft-fg [&_svg]:text-success',
        warning: 'border-warning/30 bg-warning-soft text-warning-soft-fg [&_svg]:text-warning',
        danger: 'border-danger/30 bg-danger-soft text-danger-soft-fg [&_svg]:text-danger',
        neutral: 'border-border bg-surface-muted text-fg-muted [&_svg]:text-fg-muted',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: CircleAlert,
  neutral: Info,
} as const;

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>, VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
  hideIcon?: boolean;
}

export function Alert({
  className,
  tone = 'info',
  title,
  hideIcon,
  children,
  ...props
}: AlertProps) {
  const Icon = icons[tone ?? 'info'];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {hideIcon ? null : <Icon aria-hidden />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title && 'opacity-90')}>{children}</div> : null}
      </div>
    </div>
  );
}
