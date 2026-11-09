'use client';

import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';
import { initials } from '../lib/format';

const avatarVariants = cva(
  'relative flex shrink-0 overflow-hidden rounded-full bg-accent-soft text-accent-soft-fg select-none',
  {
    variants: {
      size: {
        xs: 'size-6 text-[0.625rem]',
        sm: 'size-7 text-xs',
        md: 'size-8 text-xs',
        lg: 'size-10 text-sm',
        xl: 'size-14 text-base',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface AvatarProps
  extends
    React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {
  src?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Full accessible name; defaults to "firstName lastName". */
  name?: string;
}

export const Avatar = React.forwardRef<
  React.ComponentRef<typeof AvatarPrimitive.Root>,
  AvatarProps
>(function Avatar({ className, size, src, firstName, lastName, name, ...props }, ref) {
  const fullName = name ?? [firstName, lastName].filter(Boolean).join(' ');
  return (
    <AvatarPrimitive.Root ref={ref} className={cn(avatarVariants({ size }), className)} {...props}>
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt={fullName}
          className="aspect-square size-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="flex size-full items-center justify-center font-semibold"
        aria-label={fullName || undefined}
      >
        {initials(firstName, lastName)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
});
