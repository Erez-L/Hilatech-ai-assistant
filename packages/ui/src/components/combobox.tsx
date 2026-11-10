'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { useUiStrings } from '../lib/ui-strings';

export interface ComboboxItem {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  id?: string;
  items: readonly ComboboxItem[];
  value: string | null;
  onValueChange: (value: string | null, item: ComboboxItem | null) => void;
  /** Controlled search text. Provide together with onSearchChange for asynchronous lookups. */
  search?: string;
  onSearchChange?: (search: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: React.ReactNode;
  /** True while items are being fetched for the current search. */
  loading?: boolean;
  disabled?: boolean;
  /** Show a clear affordance when a value is selected. */
  clearable?: boolean;
  /** Label for the current value when it is not part of `items` (e.g. selected before a new search). */
  selectedLabel?: string;
  renderItem?: (item: ComboboxItem, state: { selected: boolean }) => React.ReactNode;
  /** Rendered beneath the list — a "create new" action, for example. */
  footer?: React.ReactNode;
  invalid?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
}

/**
 * Searchable single-select. Works with a static list (filtered locally) or an asynchronous source
 * (controlled `search` + `loading`). Keyboard: type to filter, arrows to move, Enter to choose,
 * Escape to close.
 */
export function Combobox({
  id,
  items,
  value,
  onValueChange,
  search,
  onSearchChange,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  loading = false,
  disabled = false,
  clearable = false,
  selectedLabel,
  renderItem,
  footer,
  invalid,
  className,
  ...aria
}: ComboboxProps) {
  const ui = useUiStrings();
  const reactId = React.useId();
  const listboxId = `${id ?? reactId}-listbox`;
  const [open, setOpen] = React.useState(false);
  const [localSearch, setLocalSearch] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const controlled = onSearchChange !== undefined;
  const query = controlled ? (search ?? '') : localSearch;

  const visible = React.useMemo(() => {
    if (controlled || !query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false),
    );
  }, [controlled, items, query]);

  const selected = items.find((item) => item.value === value) ?? null;
  const display = selected?.label ?? (value ? selectedLabel : undefined);

  const setQuery = (next: string) => {
    if (controlled) onSearchChange?.(next);
    else setLocalSearch(next);
    setActiveIndex(0);
  };

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
    } else {
      const selectedIndex = visible.findIndex((item) => item.value === value);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  };

  const choose = (item: ComboboxItem) => {
    if (item.disabled) return;
    onValueChange(item.value, item);
    changeOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (visible.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      let next = activeIndex;
      for (let i = 0; i < visible.length; i += 1) {
        next = (next + step + visible.length) % visible.length;
        if (!visible[next]?.disabled) break;
      }
      setActiveIndex(next);
      listRef.current
        ?.querySelector(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = visible[activeIndex];
      if (item) choose(item);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, visible.length - 1));
    }
  };

  const activeId = visible[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={changeOpen}>
      <div className={cn('relative', className)}>
        <PopoverPrimitive.Trigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-haspopup="listbox"
            aria-invalid={invalid || aria['aria-invalid'] ? true : undefined}
            aria-label={aria['aria-label']}
            aria-describedby={aria['aria-describedby']}
            aria-required={aria['aria-required'] || undefined}
            disabled={disabled}
            className={cn(
              'flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-sm border border-border bg-surface px-3 py-1 text-start text-sm text-fg shadow-xs',
              'transition-[border-color,box-shadow] duration-150 hover:border-border-strong',
              'focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40',
              'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-muted',
              'aria-invalid:border-danger',
              clearable && value && 'pe-14',
            )}
          >
            <span className={cn('truncate', !display && 'text-fg-subtle')}>
              {display ?? placeholder ?? ui.select}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          </button>
        </PopoverPrimitive.Trigger>
        {clearable && value && !disabled ? (
          <button
            type="button"
            aria-label={ui.clearSelection}
            onClick={(event) => {
              event.stopPropagation();
              onValueChange(null, null);
            }}
            className="absolute top-1/2 end-8 flex size-6 -translate-y-1/2 items-center justify-center rounded-xs text-fg-subtle hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          className={cn(
            'z-50 w-[var(--radix-popover-trigger-width)] min-w-[14rem] overflow-hidden rounded-md border border-border bg-surface-raised text-fg shadow-popover outline-none animate-scale-in',
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder ?? ui.search}
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full min-w-0 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
            />
            {loading ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-fg-subtle" aria-hidden />
            ) : null}
          </div>
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-busy={loading || undefined}
            className="max-h-64 overflow-y-auto p-1 scrollbar-thin"
          >
            {visible.length === 0 ? (
              <li
                role="presentation"
                className="px-2 py-6 text-center text-sm text-fg-muted"
                aria-live="polite"
              >
                {loading ? ui.searching : (emptyMessage ?? ui.noResults)}
              </li>
            ) : (
              visible.map((item, index) => {
                const isSelected = item.value === value;
                const isActive = index === activeIndex;
                return (
                  <li
                    key={item.value}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={item.disabled || undefined}
                    data-index={index}
                    onMouseMove={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(item)}
                    className={cn(
                      'flex cursor-default items-center gap-2 rounded-xs py-1.5 pe-2 ps-2 text-sm select-none',
                      isActive && 'bg-surface-muted text-fg',
                      item.disabled && 'pointer-events-none opacity-50',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      {renderItem ? (
                        renderItem(item, { selected: isSelected })
                      ) : (
                        <>
                          <span className="truncate">{item.label}</span>
                          {item.description ? (
                            <span className="truncate text-xs text-fg-muted">
                              {item.description}
                            </span>
                          ) : null}
                        </>
                      )}
                    </span>
                    {isSelected ? (
                      <Check className="size-4 shrink-0 text-accent" aria-hidden />
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
          {footer ? <div className="border-t border-border p-1">{footer}</div> : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
