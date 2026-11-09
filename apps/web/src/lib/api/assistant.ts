import type {
  AssistantMessage,
  AssistantStreamEvent,
  AssistantThread,
  CreateAssistantThreadRequest,
  PaginationQuery,
  SendAssistantMessageRequest,
  UpdateAssistantThreadRequest,
} from '@hilatech/contracts';
import { api } from './client';
import { parseAssistantEvent, streamSse } from './sse';

const enc = encodeURIComponent;

export const assistantApi = {
  threads: (query: Partial<PaginationQuery> = {}) =>
    api.list<AssistantThread>('/assistant/threads', {
      page: query.page,
      pageSize: query.pageSize,
    }),
  thread: (id: string) => api.get<AssistantThread>(`/assistant/threads/${enc(id)}`),
  createThread: (body: CreateAssistantThreadRequest = {}) =>
    api.post<AssistantThread>('/assistant/threads', body),
  updateThread: (id: string, body: UpdateAssistantThreadRequest) =>
    api.patch<AssistantThread>(`/assistant/threads/${enc(id)}`, body),
  removeThread: (id: string) => api.delete<void>(`/assistant/threads/${enc(id)}`),
  messages: (id: string, query: Partial<PaginationQuery> = {}) =>
    api.list<AssistantMessage>(`/assistant/threads/${enc(id)}/messages`, {
      page: query.page,
      pageSize: query.pageSize,
      sortOrder: 'asc',
    }),

  /** Streams the assistant answer; yields validated events (unknown events are skipped). */
  async *send(
    threadId: string,
    body: SendAssistantMessageRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<AssistantStreamEvent, void, void> {
    for await (const raw of streamSse(`/assistant/threads/${enc(threadId)}/messages`, body, {
      signal,
    })) {
      const event = parseAssistantEvent(raw);
      if (event) yield event;
    }
  },
};
