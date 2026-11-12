'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/cn';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium',
    'transition-[background-color,border-color,color,box-shadow,scale] duration-150 active:scale-[0.97]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-fg font-semibold shadow-[0_8px_18px_-8px_var(--color-accent)] hover:bg-accent-hover hover:shadow-[0_10px_22px_-8px_var(--color-accent)]',
        secondary:
          'border border-border bg-surface text-fg shadow-xs hover:bg-surface-muted hover:border-border-strong',
        ghost: 'text-fg-muted hover:bg-surface-muted hover:text-fg',
        danger: 'bg-danger text-white shadow-xs hover:bg-danger-hover',
        'danger-outline':
          'border border-danger/40 bg-surface text-danger hover:bg-danger-soft hover:border-danger',
        link: 'text-accent underline-offset-4 hover:underline h-auto px-0',
      },
      size: {
        sm: 'h-8 px-3 text-sm [&_svg]:size-3.5',
        md: 'h-9 px-3.5 text-sm [&_svg]:size-4',
        lg: 'h-11 px-5 text-base [&_svg]:size-4.5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child element instead of a <button> (e.g. a Next.js Link). */
  asChild?: boolean;
  /** Shows a spinner, disables the button and keeps its width. */
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    asChild = false,
    loading = false,
    disabled,
    leadingIcon,
    trailingIcon,
    children,
    type,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  const isDisabled = disabled || loading;
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : isDisabled}
      aria-disabled={asChild && isDisabled ? true : undefined}
      aria-busy={loading || undefined}
      type={asChild ? undefined : (type ?? 'button')}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2 className="animate-spin" aria-hidden /> : leadingIcon}
          {children}
          {!loading && trailingIcon}
        </>
      )}
    </Comp>
  );
});

export const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center rounded-sm',
    'transition-colors duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        ghost: 'text-fg-muted hover:bg-surface-muted hover:text-fg',
        secondary:
          'border border-border bg-surface text-fg-muted shadow-xs hover:bg-surface-muted hover:text-fg',
        danger: 'text-fg-muted hover:bg-danger-soft hover:text-danger',
      },
      size: {
        sm: 'size-7 [&_svg]:size-3.5',
        md: 'size-8 [&_svg]:size-4',
        lg: 'size-10 [&_svg]:size-5',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  /** Accessible name — required because the button has no visible text. */
  label: string;
  asChild?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, label, asChild = false, type, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      aria-label={label}
      title={label}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </Comp>
  );
});
