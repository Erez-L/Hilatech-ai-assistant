'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { IconButton } from './button';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: 'left' | 'right';
  /** Accessible title (visually hidden unless you render your own). */
  title: string;
  description?: string;
  /** Render the close button outside the panel (useful for navigation drawers). */
  closeOutside?: boolean;
}

/** Side drawer built on Radix Dialog (focus trap, escape, scroll lock). */
export const SheetContent = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  function SheetContent({ side = 'left', title, description, closeOutside, className, children, ...props }, ref) {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay animate-fade-in" />
        <DialogPrimitive.Content
          ref={ref}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-y-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-dialog focus:outline-none',
            side === 'left' ? 'left-0 animate-slide-in-left' : 'right-0 border-l border-border',
            className,
          )}
          {...props}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
          ) : null}
          {children}
          <DialogPrimitive.Close asChild>
            <IconButton
              label="Close"
              variant="secondary"
              className={cn(
                'absolute top-3',
                closeOutside ? (side === 'left' ? '-right-11' : '-left-11') : 'right-3',
              )}
            >
              <X aria-hidden />
            </IconButton>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
