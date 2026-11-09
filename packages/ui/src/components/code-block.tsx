'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../lib/cn';

export interface CodeBlockProps extends Omit<React.HTMLAttributes<HTMLPreElement>, 'children'> {
  /** Raw code — rendered as text, never as HTML. */
  code: string;
  /** Optional language hint shown in the header (no highlighting is applied). */
  language?: string | null;
  /** Show a copy-to-clipboard button (default true). */
  copyable?: boolean;
  /** Cap the visible height; longer content scrolls. */
  maxHeight?: number | string;
  size?: 'sm' | 'md';
}

/**
 * Monospace block for code, prompts and raw payloads. Content is always escaped text, so it is safe
 * for model output. The copy button announces its result for assistive technology.
 */
export function CodeBlock({
  code,
  language,
  copyable = true,
  maxHeight,
  size = 'sm',
  className,
  ...props
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the text stays selectable.
    }
  };

  const showHeader = !!language || copyable;

  return (
    <div
      className={cn(
        'group/code relative overflow-hidden rounded-md border border-border bg-surface-muted/60',
        className,
      )}
    >
      {showHeader ? (
        <div className="flex h-7 items-center justify-between gap-2 border-b border-border/70 px-2.5">
          <span className="font-mono text-2xs text-fg-subtle">{language ?? ''}</span>
          {copyable ? (
            <button
              type="button"
              onClick={() => void copy()}
              aria-label={copied ? 'Copied' : 'Copy code'}
              className="inline-flex h-5 items-center gap-1 rounded-xs px-1.5 text-2xs text-fg-muted transition-colors hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {copied ? (
                <Check className="size-3 text-success" aria-hidden />
              ) : (
                <Copy className="size-3" aria-hidden />
              )}
              <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      <pre
        className={cn(
          'overflow-auto px-3 py-2.5 font-mono leading-relaxed whitespace-pre text-fg scrollbar-thin',
          size === 'sm' ? 'text-xs' : 'text-sm',
        )}
        style={maxHeight != null ? { maxHeight } : undefined}
        tabIndex={0}
        {...props}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
