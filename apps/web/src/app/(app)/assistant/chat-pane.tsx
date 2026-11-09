'use client';

import * as React from 'react';
import { ArrowLeft, Bot, SendHorizontal, X } from 'lucide-react';
import {
  Permission,
  type AssistantMessage,
  type SendAssistantMessageRequest,
} from '@hilatech/contracts';
import {
  Alert,
  AutosizeTextarea,
  Badge,
  Button,
  EmptyState,
  IconButton,
  Skeleton,
  cn,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useAssistantMessages, useContact, useLead, useAssistantThreads } from '@/hooks/queries';
import { useAssistantStream, type StreamState } from '@/hooks/use-assistant-stream';
import { useCan } from '@/hooks/use-can';
import { contactName } from '@/lib/crm';
import { AiNotConfigured } from '@/components/ai/ai-not-configured';
import { Markdown } from '@/components/ai/markdown';
import { ToolChip, outcomeFromResult, type ToolOutcome } from '@/components/ai/tool-chip';
import { threadTitle } from './thread-list';

type Context = NonNullable<SendAssistantMessageRequest['context']>;

export function ChatPane({
  threadId,
  context,
  onBack,
}: {
  threadId: string;
  context: Context;
  onBack: () => void;
  onDeleted?: () => void;
}) {
  const threads = useAssistantThreads({ page: 1, pageSize: 100 });
  const title = threadTitle(threads.data?.data.find((t) => t.id === threadId) ?? { title: null });
  const messages = useAssistantMessages(threadId);
  const { state, send, dismissError, streaming } = useAssistantStream(threadId);
  const [contextDismissed, setContextDismissed] = React.useState(false);
  const activeContext = contextDismissed ? undefined : context;

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const items = React.useMemo(() => foldMessages(messages.data?.data ?? []), [messages.data]);
  const tick = `${items.length}:${state.text.length}:${state.tools.length}`;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tick]);

  const notConfigured = state.error?.code === 'AI_NOT_CONFIGURED';

  return (
    <section
      aria-label="Assistant chat"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface"
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <IconButton label="Back to threads" className="lg:hidden" onClick={onBack}>
          <ArrowLeft aria-hidden />
        </IconButton>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        {activeContext && Object.keys(activeContext).length > 0 ? (
          <ContextChip context={activeContext} onDismiss={() => setContextDismissed(true)} />
        ) : null}
      </header>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Messages"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-bg/40 px-4 py-4 scrollbar-thin"
      >
        {messages.isPending ? (
          <div className="flex flex-col gap-4" aria-busy>
            <Skeleton className="ml-auto h-10 w-1/2 rounded-xl" />
            <Skeleton className="h-16 w-2/3 rounded-xl" />
          </div>
        ) : messages.isError ? (
          <div className="m-auto flex flex-col items-center gap-2 text-center text-sm text-fg-muted">
            <span>{getErrorMessage(messages.error)}</span>
            <Button size="sm" variant="secondary" onClick={() => void messages.refetch()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 && state.status === 'idle' ? (
          <div className="m-auto">
            <EmptyState
              compact
              icon={<Bot />}
              title="Ask the assistant"
              description="Try “Which leads need a follow-up this week?” or “Summarise this lead”."
            />
          </div>
        ) : (
          <>
            {items.map((item) =>
              item.kind === 'user' ? (
                <UserBubble key={item.message.id} content={item.message.content} />
              ) : (
                <AssistantBlock key={item.message.id} item={item} />
              ),
            )}
            <LiveTurn state={state} />
          </>
        )}
      </div>

      {state.status === 'error' && state.error ? (
        <div className="border-t border-border px-4 py-3">
          {notConfigured ? (
            <AiNotConfigured compact />
          ) : (
            <Alert tone="danger" title="The assistant couldn’t answer">
              <div className="flex flex-wrap items-center gap-3">
                <span>{state.error.message}</span>
                <Button size="sm" variant="secondary" onClick={dismissError}>
                  Dismiss
                </Button>
              </div>
            </Alert>
          )}
        </div>
      ) : null}

      <AssistantComposer
        disabled={streaming || notConfigured}
        streaming={streaming}
        onSend={(content) => send(content, activeContext)}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------

type FoldedItem =
  | { kind: 'user'; message: AssistantMessage }
  | {
      kind: 'assistant';
      message: AssistantMessage;
      tools: {
        id: string;
        name: string;
        input: Record<string, unknown>;
        outcome: ToolOutcome;
        result: unknown;
      }[];
    };

/** Pairs assistant tool calls with their tool-result rows and drops the raw tool/system rows. */
export function foldMessages(messages: AssistantMessage[]): FoldedItem[] {
  const results = new Map<string, AssistantMessage>();
  for (const m of messages) if (m.role === 'tool' && m.toolCallId) results.set(m.toolCallId, m);
  const out: FoldedItem[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ kind: 'user', message: m });
    else if (m.role === 'assistant') {
      const tools = (m.toolCalls ?? []).map((call) => {
        const res = results.get(call.id);
        return {
          id: call.id,
          name: call.name,
          input: call.input,
          outcome: res
            ? outcomeFromResult(res.content, res.metadata?.isError === true)
            : ('ok' as ToolOutcome),
          result: res ? parseMaybeJson(res.content) : undefined,
        };
      });
      if (m.content.trim() || tools.length > 0) out.push({ kind: 'assistant', message: m, tools });
    }
  }
  return out;
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1 sm:max-w-[75%]">
      <div className="rounded-xl rounded-tr-sm bg-accent-soft px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-accent-soft-fg shadow-xs">
        {content}
      </div>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-info-soft text-info-soft-fg"
      aria-hidden
    >
      <Bot className="size-4" />
    </span>
  );
}

function AssistantBlock({ item }: { item: Extract<FoldedItem, { kind: 'assistant' }> }) {
  const { message, tools } = item;
  const hasUsage = message.inputTokens != null || message.outputTokens != null;
  return (
    <div className="mr-auto flex max-w-[90%] gap-2.5 sm:max-w-[80%]">
      <AssistantAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {tools.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {tools.map((t) => (
              <ToolChip
                key={t.id}
                name={t.name}
                outcome={t.outcome}
                input={t.input}
                result={t.result}
              />
            ))}
          </div>
        ) : null}
        {message.content.trim() ? (
          <div className="rounded-xl rounded-tl-sm border border-info/20 bg-surface px-3.5 py-2 text-sm leading-relaxed shadow-xs">
            <Markdown source={message.content} />
          </div>
        ) : null}
        {hasUsage ? (
          <p className="text-2xs text-fg-subtle tabular">
            {message.inputTokens ?? 0} in · {message.outputTokens ?? 0} out tokens
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LiveTurn({ state }: { state: StreamState }) {
  if (state.status === 'idle' || state.userContent == null) return null;
  return (
    <>
      <UserBubble content={state.userContent} />
      {state.status === 'streaming' || state.text || state.tools.length > 0 ? (
        <div
          className="mr-auto flex max-w-[90%] gap-2.5 sm:max-w-[80%]"
          aria-busy={state.status === 'streaming'}
        >
          <AssistantAvatar />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {state.tools.map((t) => (
              <ToolChip
                key={t.id}
                name={t.name}
                input={t.input}
                summary={t.summary}
                outcome={
                  t.status === 'running'
                    ? 'running'
                    : t.ok
                      ? 'ok'
                      : /denied|authoriz|permission/i.test(t.summary ?? '')
                        ? 'denied'
                        : 'error'
                }
              />
            ))}
            {state.text ? (
              <div className="rounded-xl rounded-tl-sm border border-info/20 bg-surface px-3.5 py-2 text-sm leading-relaxed shadow-xs">
                <Markdown source={state.text} />
              </div>
            ) : state.status === 'streaming' && state.tools.length === 0 ? (
              <p className="text-xs text-fg-subtle" role="status">
                Thinking…
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ContextChip({ context, onDismiss }: { context: Context; onDismiss: () => void }) {
  const canLeads = useCan(Permission.LEADS_READ);
  const canContacts = useCan(Permission.CONTACTS_READ);
  const lead = useLead(canLeads ? (context.leadId ?? null) : null);
  const contact = useContact(canContacts ? (context.contactId ?? null) : null);
  const parts: string[] = [];
  if (context.leadId) parts.push(`Lead: ${lead.data?.title ?? 'selected lead'}`);
  if (context.contactId)
    parts.push(`Contact: ${contact.data ? contactName(contact.data) : 'selected contact'}`);
  if (context.conversationId) parts.push('Conversation attached');
  return (
    <Badge variant="accent" className="max-w-xs gap-1.5 pr-1">
      <span className="truncate" title="Sent with each message as context">
        {parts.join(' · ')}
      </span>
      <button
        type="button"
        aria-label="Remove context"
        onClick={onDismiss}
        className="flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-accent/20"
      >
        <X className="size-3" aria-hidden />
      </button>
    </Badge>
  );
}

// ---------------------------------------------------------------------------

export function AssistantComposer({
  onSend,
  disabled,
  streaming,
}: {
  onSend: (content: string) => void | Promise<unknown>;
  disabled?: boolean;
  streaming?: boolean;
}) {
  const [draft, setDraft] = React.useState('');
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const canSend = draft.trim().length > 0 && !disabled;

  const submit = () => {
    const content = draft.trim();
    if (!content || disabled) return;
    setDraft('');
    void onSend(content);
  };

  React.useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  return (
    <form
      className="flex flex-col gap-2 border-t border-border bg-surface px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      aria-busy={streaming || undefined}
    >
      <div
        className={cn(
          'flex items-end gap-2 rounded-md border border-border bg-surface px-3 py-2 focus-within:border-accent',
          disabled && 'opacity-60',
        )}
      >
        <AutosizeTextarea
          ref={ref}
          aria-label="Message the assistant"
          value={draft}
          disabled={disabled}
          minRows={1}
          maxRows={8}
          maxLength={50000}
          placeholder="Ask anything — Enter to send, Shift+Enter for a new line"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
          className="flex-1 border-0 bg-transparent px-0 py-1 shadow-none focus-visible:outline-none"
        />
        <Button
          type="submit"
          size="sm"
          loading={streaming}
          disabled={!canSend}
          trailingIcon={<SendHorizontal aria-hidden />}
        >
          Send
        </Button>
      </div>
    </form>
  );
}
