'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SendAssistantMessageRequest } from '@hilatech/contracts';
import { assistantApi, isApiError, keys } from '@/lib/api';
import { useSession } from '@/stores/session';

export interface StreamingTool {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'done';
  ok?: boolean;
  summary?: string;
}

export interface StreamState {
  status: 'idle' | 'streaming' | 'error';
  /** The user message being answered (shown optimistically until the persisted list refreshes). */
  userContent: string | null;
  text: string;
  tools: StreamingTool[];
  error: { code: string; message: string } | null;
}

const IDLE: StreamState = { status: 'idle', userContent: null, text: '', tools: [], error: null };

/**
 * Sends a message to an assistant thread over SSE and exposes the in-flight answer (text deltas and
 * tool calls). When the turn ends the persisted messages are refetched and the live state clears.
 */
export function useAssistantStream(threadId: string | null) {
  const qc = useQueryClient();
  const orgId = useSession((s) => s.activeOrganizationId);
  const [state, setState] = React.useState<StreamState>(IDLE);
  const abort = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    // Switching threads abandons the in-flight view (the server still finishes and persists the turn).
    return () => {
      abort.current?.abort();
      abort.current = null;
    };
  }, [threadId]);

  React.useEffect(() => setState(IDLE), [threadId]);

  const send = React.useCallback(
    async (content: string, context?: SendAssistantMessageRequest['context']) => {
      if (!threadId) return;
      const controller = new AbortController();
      abort.current = controller;
      setState({ ...IDLE, status: 'streaming', userContent: content });
      const refresh = async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: keys.assistantMessages(orgId, threadId) }),
          qc.invalidateQueries({ queryKey: [...keys.assistantRoot(orgId), 'threads'] }),
          qc.invalidateQueries({ queryKey: keys.aiUsage(orgId) }),
        ]);
      };
      try {
        let ended = false;
        for await (const event of assistantApi.send(
          threadId,
          { content, ...(context && Object.keys(context).length ? { context } : {}) },
          controller.signal,
        )) {
          switch (event.type) {
            case 'text_delta':
              setState((s) => ({ ...s, text: s.text + event.delta }));
              break;
            case 'tool_call':
              setState((s) => ({
                ...s,
                tools: [
                  ...s.tools,
                  {
                    id: event.toolCall.id,
                    name: event.toolCall.name,
                    input: event.toolCall.input,
                    status: 'running',
                  },
                ],
              }));
              break;
            case 'tool_result':
              setState((s) => ({
                ...s,
                tools: s.tools.map((t) =>
                  t.id === event.toolCallId
                    ? { ...t, status: 'done', ok: event.ok, summary: event.summary }
                    : t,
                ),
              }));
              break;
            case 'message_end':
              ended = true;
              await refresh();
              setState(IDLE);
              break;
            case 'error':
              ended = true;
              await refresh();
              setState((s) => ({
                ...s,
                status: 'error',
                error: { code: event.code, message: event.message },
              }));
              break;
            default:
              break;
          }
        }
        if (!ended) {
          await refresh();
          setState(IDLE);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        await refresh();
        setState((s) => ({
          ...s,
          status: 'error',
          error: isApiError(error)
            ? { code: error.code, message: error.message }
            : { code: 'NETWORK_ERROR', message: 'The connection was interrupted. Try again.' },
        }));
      }
    },
    [threadId, qc, orgId],
  );

  const dismissError = React.useCallback(() => setState(IDLE), []);

  return { state, send, dismissError, streaming: state.status === 'streaming' };
}
