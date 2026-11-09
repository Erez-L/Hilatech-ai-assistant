'use client';

import * as React from 'react';
import { ALL_DOMAIN_EVENTS, type DomainEvent } from '@hilatech/contracts';
import { Button, Checkbox, Label } from '@hilatech/ui';
import { eventLabel } from '@/lib/automation';

/** Multi-select of domain events as a checkbox grid (every box has its own accessible name). */
export function EventPicker({
  idPrefix,
  value,
  onChange,
  error,
}: {
  idPrefix: string;
  value: DomainEvent[];
  onChange: (next: DomainEvent[]) => void;
  error?: string;
}) {
  const all = value.length === ALL_DOMAIN_EVENTS.length;
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={error ? `${idPrefix}-error` : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <legend className="text-sm font-medium">
          Events <span aria-hidden>*</span>
        </legend>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(all ? [] : [...ALL_DOMAIN_EVENTS])}
        >
          {all ? 'Clear all' : 'Select all'}
        </Button>
      </div>
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {ALL_DOMAIN_EVENTS.map((ev) => {
          const id = `${idPrefix}-${ev.replace(/\W/g, '-')}`;
          return (
            <div key={ev} className="flex items-center gap-2">
              <Checkbox
                id={id}
                aria-label={`Event ${ev}`}
                checked={value.includes(ev)}
                onCheckedChange={(checked) =>
                  onChange(checked ? [...value, ev] : value.filter((v) => v !== ev))
                }
              />
              <Label htmlFor={id} className="font-normal">
                {eventLabel(ev)} <span className="font-mono text-xs text-fg-muted">{ev}</span>
              </Label>
            </div>
          );
        })}
      </div>
      {error ? (
        <p id={`${idPrefix}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
