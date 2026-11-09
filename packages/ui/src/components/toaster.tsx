'use client';

import * as React from 'react';
import { Toaster as SonnerToaster, toast, type ToasterProps } from 'sonner';
import { CheckCircle2, CircleAlert, Info, Loader2, TriangleAlert } from 'lucide-react';

export { toast };

/** Sonner toaster themed with design tokens. Mount once in the root layout. */
export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      duration={4500}
      gap={8}
      icons={{
        success: <CheckCircle2 className="size-4 text-success" aria-hidden />,
        error: <CircleAlert className="size-4 text-danger" aria-hidden />,
        warning: <TriangleAlert className="size-4 text-warning" aria-hidden />,
        info: <Info className="size-4 text-info" aria-hidden />,
        loading: <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden />,
      }}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            '!rounded-md !border !border-border !bg-surface-raised !text-fg !shadow-popover !font-sans !text-sm !items-start !gap-3 !px-4 !py-3',
          title: '!font-medium !text-fg',
          description: '!text-fg-muted !text-xs',
          actionButton: '!bg-accent !text-accent-fg !rounded-sm !text-xs !font-medium',
          cancelButton: '!bg-surface-muted !text-fg-muted !rounded-sm !text-xs',
          closeButton: '!bg-surface-raised !border-border !text-fg-muted hover:!bg-surface-muted hover:!text-fg',
          icon: '!mt-0.5',
        },
      }}
      {...props}
    />
  );
}
