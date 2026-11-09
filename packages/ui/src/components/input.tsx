'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/cn';

export const inputClassName = cn(
  'flex h-9 w-full min-w-0 rounded-sm border border-border bg-surface px-3 py-1 text-sm text-fg shadow-xs',
  'placeholder:text-fg-subtle',
  'transition-[border-color,box-shadow] duration-150',
  'hover:border-border-strong',
  'focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40',
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-muted',
  'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger/40',
  'file:border-0 file:bg-transparent file:text-sm file:font-medium',
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || props['aria-invalid'] ? true : undefined}
      className={cn(inputClassName, className)}
      {...props}
    />
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || props['aria-invalid'] ? true : undefined}
      className={cn(
        inputClassName,
        'h-auto min-h-[2.25rem] resize-y py-2 leading-relaxed',
        className,
      )}
      {...props}
    />
  );
});

export interface AutosizeTextareaProps extends TextareaProps {
  minRows?: number;
  maxRows?: number;
}

/** Textarea that grows with its content between minRows and maxRows (composers, note fields). */
export const AutosizeTextarea = React.forwardRef<HTMLTextAreaElement, AutosizeTextareaProps>(
  function AutosizeTextarea(
    { minRows = 1, maxRows = 8, className, onChange, value, defaultValue, ...props },
    ref,
  ) {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

    const resize = React.useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      const styles = window.getComputedStyle(el);
      const lineHeight = parseFloat(styles.lineHeight) || 20;
      const padding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const border = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
      el.style.height = 'auto';
      const min = lineHeight * minRows + padding + border;
      const max = lineHeight * maxRows + padding + border;
      const next = Math.min(Math.max(el.scrollHeight + border, min), max);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight + border > max ? 'auto' : 'hidden';
    }, [minRows, maxRows]);

    React.useLayoutEffect(() => {
      resize();
    }, [resize, value]);

    return (
      <Textarea
        ref={innerRef}
        rows={minRows}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          onChange?.(event);
          resize();
        }}
        className={cn('resize-none', className)}
        {...props}
      />
    );
  },
);

export interface SearchInputProps extends Omit<InputProps, 'onChange' | 'value'> {
  value: string;
  onValueChange: (value: string) => void;
  /** Debounce in ms before onValueChange fires. 0 disables debouncing. */
  debounceMs?: number;
}

/** Search field with a leading icon and a clear button. Debounces the callback. */
export function SearchInput({
  value,
  onValueChange,
  debounceMs = 250,
  className,
  placeholder = 'Search…',
  ...props
}: SearchInputProps) {
  const [draft, setDraft] = React.useState(value);
  const [lastValue, setLastValue] = React.useState(value);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync the draft when the controlled value changes from outside (e.g. filters reset).
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  const emit = React.useCallback(
    (next: string) => {
      if (timer.current) clearTimeout(timer.current);
      if (debounceMs <= 0) {
        onValueChange(next);
        return;
      }
      timer.current = setTimeout(() => onValueChange(next), debounceMs);
    },
    [debounceMs, onValueChange],
  );

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden
      />
      <Input
        type="search"
        role="searchbox"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          emit(e.target.value);
        }}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            if (timer.current) clearTimeout(timer.current);
            onValueChange('');
          }}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-xs text-fg-subtle hover:bg-surface-muted hover:text-fg"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** Styled native <select>; the simplest accessible choice for forms using register(). */
export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ className, invalid, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          aria-invalid={invalid || props['aria-invalid'] ? true : undefined}
          className={cn(inputClassName, 'appearance-none pr-9', className)}
          {...props}
        >
          {children}
        </select>
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </div>
    );
  },
);
