'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';
import { CodeBlock } from './code-block';
import { useUiStrings } from '../lib/ui-strings';

export interface JsonViewerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Any JSON-serialisable value (objects, arrays, strings, numbers, booleans, null). */
  value: unknown;
  /** Levels expanded on first render; the root entries are always listed (1 = nested containers start collapsed). */
  defaultExpandedDepth?: number;
  /** Text shown when the value is null/undefined. */
  emptyLabel?: string;
  /** Show a "Raw" toggle that renders the pretty-printed JSON in a CodeBlock. */
  allowRaw?: boolean;
  /** Cap the visible height; longer trees scroll. */
  maxHeight?: number | string;
}

type Kind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

function kindOf(value: unknown): Kind {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
}

function entriesOf(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.map((v, i) => [String(i), v]);
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>);
  return [];
}

function previewOf(value: unknown, kind: Kind): string {
  if (kind === 'array') return `[${(value as unknown[]).length}]`;
  if (kind === 'object') return `{${Object.keys(value as object).length}}`;
  if (kind === 'string') return JSON.stringify(value);
  if (kind === 'null') return 'null';
  return String(value);
}

const primitiveClass: Record<Kind, string> = {
  string: 'text-success-soft-fg',
  number: 'text-info-soft-fg',
  boolean: 'text-warning-soft-fg',
  null: 'text-fg-subtle italic',
  object: 'text-fg-muted',
  array: 'text-fg-muted',
};

/**
 * Collapsible tree for inspecting JSON payloads (tool inputs, agent step output, schemas). Values
 * render as text — never as HTML — so model-produced content is safe to display.
 */
export function JsonViewer({
  value,
  defaultExpandedDepth = 1,
  emptyLabel,
  allowRaw = true,
  maxHeight,
  className,
  ...props
}: JsonViewerProps) {
  const ui = useUiStrings();
  const [raw, setRaw] = React.useState(false);
  const kind = kindOf(value);
  const isContainer = kind === 'object' || kind === 'array';
  const empty =
    value === null || value === undefined || (isContainer && entriesOf(value).length === 0);

  const serialised = React.useMemo(() => {
    try {
      return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      return String(value);
    }
  }, [value]);

  if (empty) {
    return (
      <div className={cn('text-sm text-fg-subtle', className)} {...props}>
        {emptyLabel ?? ui.empty}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      {allowRaw && isContainer ? (
        <div className="flex justify-end">
          <button
            type="button"
            aria-pressed={raw}
            onClick={() => setRaw((v) => !v)}
            className="rounded-xs px-1.5 py-0.5 text-2xs text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            {raw ? ui.tree : ui.raw}
          </button>
        </div>
      ) : null}
      {raw || !isContainer ? (
        <CodeBlock code={serialised} language="json" maxHeight={maxHeight} />
      ) : (
        <div
          className="overflow-auto rounded-md border border-border bg-surface-muted/60 px-2 py-1.5 font-mono text-xs scrollbar-thin"
          style={maxHeight != null ? { maxHeight } : undefined}
        >
          <ul role="tree" aria-label="JSON" className="flex flex-col">
            {entriesOf(value).map(([key, child]) => (
              <JsonNode
                key={key}
                name={key}
                value={child}
                depth={1}
                defaultExpandedDepth={defaultExpandedDepth}
                isIndex={kind === 'array'}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function JsonNode({
  name,
  value,
  depth,
  defaultExpandedDepth,
  isIndex,
}: {
  name: string;
  value: unknown;
  depth: number;
  defaultExpandedDepth: number;
  isIndex: boolean;
}) {
  const ui = useUiStrings();
  const kind = kindOf(value);
  const isContainer = kind === 'object' || kind === 'array';
  const children = isContainer ? entriesOf(value) : [];
  const [open, setOpen] = React.useState(depth < defaultExpandedDepth);
  const expandable = isContainer && children.length > 0;

  return (
    <li
      role="treeitem"
      aria-expanded={expandable ? open : undefined}
      className="flex flex-col"
      style={{ paddingInlineStart: depth > 1 ? 12 : 0 }}
    >
      <div className="flex min-w-0 items-start gap-1 leading-6">
        {expandable ? (
          <button
            type="button"
            aria-label={open ? ui.collapse(name) : ui.expand(name)}
            onClick={() => setOpen((v) => !v)}
            className="mt-1.5 flex size-3.5 shrink-0 items-center justify-center rounded-xs text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          >
            <ChevronRight
              className={cn('size-3 transition-transform', open && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : (
          <span className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className={cn('shrink-0', isIndex ? 'text-fg-subtle' : 'text-fg')}>{name}</span>
        <span className="text-fg-subtle">:</span>
        {expandable && open ? (
          <span className="text-fg-subtle">{kind === 'array' ? '[' : '{'}</span>
        ) : (
          <span className={cn('min-w-0 break-all', primitiveClass[kind])}>
            {previewOf(value, kind)}
          </span>
        )}
      </div>
      {expandable && open ? (
        <ul role="group" className="flex flex-col">
          {children.map(([key, child]) => (
            <JsonNode
              key={key}
              name={key}
              value={child}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
              isIndex={kind === 'array'}
            />
          ))}
          <li aria-hidden className="ps-[1.125rem] leading-6 text-fg-subtle">
            {kind === 'array' ? ']' : '}'}
          </li>
        </ul>
      ) : null}
    </li>
  );
}
