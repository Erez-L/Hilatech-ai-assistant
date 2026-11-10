'use client';

import { useUiStrings } from '../lib/ui-strings';
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'border-transparent bg-surface-muted text-fg-muted',
        outline: 'border-border bg-transparent text-fg-muted',
        accent: 'border-transparent bg-accent-soft text-accent-soft-fg',
        success: 'border-transparent bg-success-soft text-success-soft-fg',
        warning: 'border-transparent bg-warning-soft text-warning-soft-fg',
        danger: 'border-transparent bg-danger-soft text-danger-soft-fg',
        info: 'border-transparent bg-info-soft text-info-soft-fg',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Show a leading dot in the badge colour. */
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-80" aria-hidden /> : null}
      {children}
    </span>
  );
}

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const STATUS_TONES: Record<string, StatusTone> = {
  active: 'success',
  accepted: 'success',
  won: 'success',
  verified: 'success',
  trialing: 'info',
  pending: 'warning',
  past_due: 'warning',
  incomplete: 'warning',
  suspended: 'danger',
  revoked: 'danger',
  expired: 'neutral',
  canceled: 'neutral',
  new: 'info',
  open: 'accent',
  closed: 'neutral',
  // Lead pipeline
  contacted: 'neutral',
  qualified: 'accent',
  proposal: 'warning',
  lost: 'danger',
  // Conversations
  resolved: 'success',
  archived: 'neutral',
};

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant'> {
  status: string;
  /** Override the automatic tone mapping. */
  tone?: StatusTone;
  /** Override the label (defaults to a humanised status). */
  label?: string;
}

/** Badge whose tone is derived from a well-known status string (member, invitation, subscription…). */
export function StatusBadge({ status, tone, label, ...props }: StatusBadgeProps) {
  const ui = useUiStrings();
  const variant = tone ?? STATUS_TONES[status] ?? 'neutral';
  return (
    <Badge variant={variant} dot {...props}>
      {label ?? ui.statusLabel(status)}
    </Badge>
  );
}

export function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
