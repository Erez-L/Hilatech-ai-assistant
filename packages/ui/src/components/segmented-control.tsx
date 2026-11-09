'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

export interface SegmentedOption<V extends string> {
  value: V;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string> extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onChange' | 'defaultValue'
> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
  size?: 'sm' | 'md';
  /** Accessible name for the group — required because segments alone do not describe the choice. */
  'aria-label': string;
  disabled?: boolean;
}

/**
 * Mutually exclusive choice rendered as a compact pill group (period switchers, view toggles).
 * Implements the radiogroup pattern: one tab stop, arrow keys move the selection.
 */
export function SegmentedControl<V extends string>({
  options,
  value,
  onValueChange,
  size = 'md',
  className,
  disabled,
  ...props
}: SegmentedControlProps<V>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.map((o, i) => ({ o, i })).filter(({ o }) => !o.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex(({ o }) => o.value === value);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      nextIndex = (current + 1) % enabled.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      nextIndex = (current - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = enabled.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const target = enabled[nextIndex];
    if (!target) return;
    onValueChange(target.o.value);
    refs.current[target.i]?.focus();
  };

  return (
    <div
      role="radiogroup"
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-muted p-0.5',
        disabled && 'opacity-60',
        className,
      )}
      {...props}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium whitespace-nowrap transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              size === 'sm'
                ? 'h-6 px-2 text-xs [&_svg]:size-3.5'
                : 'h-7 px-2.5 text-xs [&_svg]:size-4',
              active
                ? 'bg-surface text-fg shadow-xs'
                : 'text-fg-muted hover:text-fg [&:not(:disabled)]:hover:bg-surface/60',
            )}
          >
            {option.icon ? <span aria-hidden>{option.icon}</span> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
