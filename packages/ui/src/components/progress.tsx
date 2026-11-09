import * as React from 'react';
import { cn } from '../lib/cn';

export interface MeterProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  /** null → unlimited (renders a muted, full track with no fill). */
  max: number | null;
  label?: string;
  /** Thresholds (ratios) where the fill switches to warning / danger. */
  warnAt?: number;
  dangerAt?: number;
  size?: 'sm' | 'md';
}

/** Usage meter: fill colour carries severity; the unfilled track is a lighter step of the same ramp. */
export function Meter({ value, max, label, warnAt = 0.75, dangerAt = 0.9, size = 'md', className, ...props }: MeterProps) {
  const ratio = max == null || max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const tone = ratio >= dangerAt ? 'danger' : ratio >= warnAt ? 'warning' : 'accent';
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max ?? undefined}
      aria-valuenow={Math.min(value, max ?? value)}
      aria-valuetext={max == null ? `${value} used, no limit` : `${value} of ${max}`}
      className={cn(
        'w-full overflow-hidden rounded-full',
        size === 'sm' ? 'h-1.5' : 'h-2',
        tone === 'accent' && 'bg-accent-soft',
        tone === 'warning' && 'bg-warning-soft',
        tone === 'danger' && 'bg-danger-soft',
        max == null && 'bg-surface-muted',
        className,
      )}
      {...props}
    >
      {max == null ? null : (
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300',
            tone === 'accent' && 'bg-accent',
            tone === 'warning' && 'bg-warning',
            tone === 'danger' && 'bg-danger',
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      )}
    </div>
  );
}
