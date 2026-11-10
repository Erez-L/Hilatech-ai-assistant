'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { Label } from './label';
import { useUiStrings } from '../lib/ui-strings';

export interface FormFieldProps {
  /** id of the control; used for label htmlFor and aria-describedby wiring. */
  id: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  /** Render label after the control (checkbox / switch rows). */
  inline?: boolean;
  className?: string;
  children: React.ReactElement<Record<string, unknown>>;
}

/**
 * Wires a label, optional description and error to a single form control.
 * The child receives id, aria-describedby and aria-invalid automatically.
 */
export function FormField({
  id,
  label,
  description,
  error,
  required,
  inline = false,
  className,
  children,
}: FormFieldProps) {
  const ui = useUiStrings();
  if (typeof error === 'string') error = ui.formatMessage(error);
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  const control = React.cloneElement(children, {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : children.props['aria-invalid'],
    'aria-required': required || undefined,
  });

  if (inline) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <div className="flex items-center gap-2.5">
          {control}
          {label ? (
            <Label htmlFor={id} required={required} className="font-normal">
              {label}
            </Label>
          ) : null}
        </div>
        {description ? (
          <p id={descriptionId} className="ps-7 text-xs text-fg-muted">
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} role="alert" className="ps-7 text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      ) : null}
      {control}
      {description && !error ? (
        <p id={descriptionId} className="text-xs text-fg-muted">
          {description}
        </p>
      ) : null}
      {description && error ? (
        <p id={descriptionId} className="sr-only">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
