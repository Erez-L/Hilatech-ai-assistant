'use client';

import * as React from 'react';
import { Toaster as SonnerToaster, toast, type ToasterProps } from 'sonner';
import { useDirection } from '@radix-ui/react-direction';
import { CheckCircle2, CircleAlert, Info, Loader2, TriangleAlert } from 'lucide-react';

export { toast };

/** Coloured tile behind a toast's status icon. */
function ToastIcon({ className, icon }: { className: string; icon: React.ReactNode }) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-sm text-white [&_svg]:size-4 ${className}`}
    >
      {icon}
    </span>
  );
}

/** Sonner toaster themed with design tokens. Mount once in the root layout. */
export function Toaster(props: ToasterProps) {
  const dir = useDirection();
  return (
    <SonnerToaster
      dir={dir}
      position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'}
      closeButton
      duration={4500}
      gap={8}
      icons={{
        success: <ToastIcon className="bg-success" icon={<CheckCircle2 aria-hidden />} />,
        error: <ToastIcon className="bg-danger" icon={<CircleAlert aria-hidden />} />,
        warning: <ToastIcon className="bg-warning" icon={<TriangleAlert aria-hidden />} />,
        info: <ToastIcon className="bg-info" icon={<Info aria-hidden />} />,
        loading: <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden />,
      }}
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            '!rounded-lg !border !border-border !bg-surface-raised !text-fg !shadow-popover !font-sans !text-sm !items-start !gap-3 !px-3.5 !py-3',
          title: '!font-semibold !text-fg',
          description: '!text-fg-muted !text-xs',
          actionButton: '!bg-accent !text-accent-fg !rounded-sm !text-xs !font-medium',
          cancelButton: '!bg-surface-muted !text-fg-muted !rounded-sm !text-xs',
          closeButton:
            '!bg-surface-raised !border-border !text-fg-muted hover:!bg-surface-muted hover:!text-fg',
          icon: '!m-0 !size-8',
        },
      }}
      {...props}
    />
  );
}
