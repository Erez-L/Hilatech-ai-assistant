'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { IconButton } from './button';
import { useUiStrings } from '../lib/ui-strings';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Logical side: `start` is the left edge in LTR and the right edge in RTL. */
  side?: 'start' | 'end';
  /** Accessible title (visually hidden unless you render your own). */
  title: string;
  description?: string;
  /** Render the close button outside the panel (useful for navigation drawers). */
  closeOutside?: boolean;
}

/** Side drawer built on Radix Dialog (focus trap, escape, scroll lock). */
export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  { side = 'start', title, description, closeOutside, className, children, ...props },
  ref,
) {
  const ui = useUiStrings();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay animate-fade-in" />
      <DialogPrimitive.Content
        ref={ref}
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(
          'fixed inset-y-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-dialog focus:outline-none',
          side === 'start' ? 'start-0 animate-slide-in-start' : 'end-0 border-s border-border',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="sr-only">
            {description}
          </DialogPrimitive.Description>
        ) : null}
        {children}
        <DialogPrimitive.Close asChild>
          <IconButton
            label={ui.close}
            variant="secondary"
            className={cn(
              'absolute top-3',
              closeOutside ? (side === 'start' ? '-end-11' : '-start-11') : 'end-3',
            )}
          >
            <X aria-hidden />
          </IconButton>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
