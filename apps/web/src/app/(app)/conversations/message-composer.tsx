'use client';

import * as React from 'react';
import { Headset, SendHorizontal, UserRound } from 'lucide-react';
import { AutosizeTextarea, Button, SegmentedControl, cn } from '@hilatech/ui';

export type ComposerRole = 'agent' | 'customer';

export interface MessageComposerProps {
  /** Resolves when the message is accepted; the draft is cleared only then. */
  onSend: (message: { content: string; role: ComposerRole }) => Promise<unknown> | unknown;
  sending?: boolean;
  disabled?: boolean;
  /** Show the agent/customer toggle for logging what the customer said elsewhere. */
  allowCustomerRole?: boolean;
  /** Short note above the field, e.g. "Replying reopens this conversation". */
  hint?: React.ReactNode;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

const ROLE_OPTIONS = [
  { value: 'agent', label: 'Reply', icon: <Headset /> },
  { value: 'customer', label: 'Log customer message', icon: <UserRound /> },
] as const;

/** Enter sends, Shift+Enter inserts a newline. Disabled while a send is in flight. */
export function MessageComposer({
  onSend,
  sending = false,
  disabled = false,
  allowCustomerRole = true,
  hint,
  placeholder,
  autoFocus = false,
  className,
}: MessageComposerProps) {
  const [draft, setDraft] = React.useState('');
  const [role, setRole] = React.useState<ComposerRole>('agent');
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const inFlight = sending || busy;
  const blocked = disabled || inFlight;
  const canSend = draft.trim().length > 0 && !blocked;

  const submit = async () => {
    const content = draft.trim();
    if (!content || blocked) return;
    setBusy(true);
    try {
      await onSend({ content, role });
      setDraft('');
      requestAnimationFrame(() => ref.current?.focus());
    } catch {
      // The caller surfaces the error; keep the draft so nothing is lost.
    } finally {
      setBusy(false);
    }
  };

  const effectivePlaceholder =
    placeholder ??
    (role === 'customer'
      ? 'What did the customer say? Logged on their behalf.'
      : 'Write a reply — Enter to send, Shift+Enter for a new line');

  return (
    <form
      className={cn('flex flex-col gap-2 border-t border-border bg-surface px-4 py-3', className)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      aria-busy={inFlight || undefined}
    >
      {hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
      <div
        className={cn(
          'flex flex-col gap-2 rounded-md border border-border bg-surface px-3 pt-2 pb-2 transition-colors',
          'focus-within:border-accent',
          role === 'customer' && 'border-dashed bg-surface-muted/40',
          disabled && 'opacity-60',
        )}
      >
        <AutosizeTextarea
          ref={ref}
          aria-label={role === 'customer' ? 'Customer message' : 'Reply'}
          value={draft}
          autoFocus={autoFocus}
          disabled={blocked}
          minRows={1}
          maxRows={8}
          maxLength={20000}
          placeholder={effectivePlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void submit();
          }}
          className="border-0 bg-transparent px-0 py-1 shadow-none focus-visible:outline-none"
        />
        <div className="flex items-center justify-between gap-3">
          {allowCustomerRole ? (
            <SegmentedControl
              aria-label="Message role"
              size="sm"
              options={ROLE_OPTIONS}
              value={role}
              onValueChange={(v) => setRole(v)}
              disabled={blocked}
            />
          ) : (
            <span />
          )}
          <Button
            type="submit"
            size="sm"
            loading={inFlight}
            disabled={!canSend}
            trailingIcon={<SendHorizontal aria-hidden />}
          >
            {role === 'customer' ? 'Log message' : 'Send'}
          </Button>
        </div>
      </div>
    </form>
  );
}
