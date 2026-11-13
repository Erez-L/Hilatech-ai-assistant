'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { useUiStrings } from '../lib/ui-strings';

export interface TagInputProps {
  id?: string;
  value: readonly string[];
  onValueChange: (tags: string[]) => void;
  /** Known tags offered as suggestions while typing. */
  suggestions?: readonly string[];
  placeholder?: string;
  maxTags?: number;
  maxLength?: number;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
}

function normalise(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Chips with an inline text field. Enter, Tab or comma commits the draft; Backspace on an empty
 * field removes the last chip. Duplicates (case-insensitive) are ignored.
 */
export const TagInput = React.forwardRef<HTMLInputElement, TagInputProps>(function TagInput(
  {
    id,
    value,
    onValueChange,
    suggestions = [],
    placeholder,
    maxTags,
    maxLength = 40,
    disabled,
    invalid,
    className,
    ...aria
  },
  ref,
) {
  const ui = useUiStrings();
  const reactId = React.useId();
  const inputId = id ?? reactId;
  const listId = `${inputId}-suggestions`;
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  const full = maxTags !== undefined && value.length >= maxTags;

  const commit = (raw: string) => {
    const tag = normalise(raw).slice(0, maxLength);
    if (!tag) return;
    if (full) return;
    if (value.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setDraft('');
      return;
    }
    onValueChange([...value, tag]);
    setDraft('');
  };

  const remove = (index: number) => {
    onValueChange(value.filter((_, i) => i !== index));
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      if (draft.trim()) {
        event.preventDefault();
        commit(draft);
      } else if (event.key === ',') {
        event.preventDefault();
      }
    } else if (event.key === 'Tab' && draft.trim()) {
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Backspace' && !draft && value.length > 0) {
      event.preventDefault();
      remove(value.length - 1);
    }
  };

  const filteredSuggestions = suggestions.filter(
    (s) => !value.some((t) => t.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-sm border border-border-control bg-surface px-2 py-1 text-sm shadow-xs',
        'transition-[border-color,box-shadow] duration-150 hover:border-fg-muted',
        'focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-ring/40',
        disabled && 'cursor-not-allowed bg-surface-muted',
        (invalid || aria['aria-invalid']) && 'border-danger',
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.length > 0 ? (
        <ul className="contents" aria-label={ui.selectedTags}>
          {value.map((tag, index) => (
            <li
              key={tag}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-muted py-0.5 pe-1 ps-2 text-xs font-medium text-fg-muted"
            >
              <span className="truncate">{tag}</span>
              {disabled ? null : (
                <button
                  type="button"
                  aria-label={ui.removeTag(tag)}
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(index);
                  }}
                  className="flex size-4 items-center justify-center rounded-full text-fg-subtle hover:bg-border hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={draft}
        disabled={disabled || full}
        placeholder={value.length === 0 ? (placeholder ?? ui.addTag) : ''}
        list={filteredSuggestions.length > 0 ? listId : undefined}
        autoComplete="off"
        maxLength={maxLength}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={invalid || aria['aria-invalid'] ? true : undefined}
        aria-required={aria['aria-required'] || undefined}
        onChange={(event) => {
          const next = event.target.value;
          // A pasted comma-separated list commits every complete tag at once.
          if (next.includes(',')) {
            const parts = next.split(',');
            const rest = parts.pop() ?? '';
            const additions = parts
              .map(normalise)
              .filter(Boolean)
              .filter((t) => !value.some((v) => v.toLowerCase() === t.toLowerCase()));
            if (additions.length > 0) {
              const unique = Array.from(new Set(additions.map((t) => t.toLowerCase()))).map(
                (lower) => additions.find((t) => t.toLowerCase() === lower) as string,
              );
              const merged = [...value, ...unique];
              onValueChange(maxTags !== undefined ? merged.slice(0, maxTags) : merged);
            }
            setDraft(rest);
            return;
          }
          setDraft(next);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
        className="h-7 min-w-[6rem] flex-1 bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed"
      />
      {filteredSuggestions.length > 0 ? (
        <datalist id={listId}>
          {filteredSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
});
