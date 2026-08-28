import { tenantApi, ApiError } from './api';
import type { ChatMessageSummary, Citation, ConversationSummary, DeleteConversationResponse } from '@kms/contracts';

export type { ConversationSummary, ChatMessageSummary, Citation, DeleteConversationResponse };

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export type StreamMessageCallbacks = {
  onToken?: (text: string) => void;
  onDone: (payload: { messageId: string; citations: Citation[]; followUps: string[] }) => void;
  onError: (error: unknown) => void;
};

/**
 * `ChatController`'s response types are exported directly from `@kms/contracts` (unlike
 * `folders-api.ts`'s hand-mirrored locals — folders/documents keep their response shapes local to
 * the controller, chat's are published, so re-declaring them here would just be duplication).
 */
export const chatApi = {
  createConversation: () => tenantApi.post<ConversationSummary>('/chat/conversations', {}),
  listConversations: () => tenantApi.get<ConversationSummary[]>('/chat/conversations'),
  listMessages: (conversationId: string) => tenantApi.get<ChatMessageSummary[]>(`/chat/conversations/${conversationId}/messages`),
  deleteConversation: (conversationId: string) => tenantApi.del<DeleteConversationResponse>(`/chat/conversations/${conversationId}`),
  citation: (chunkId: string) => tenantApi.get<{ documentId: string; documentName: string; page?: number }>(`/chat/citations/${chunkId}`),

  /**
   * Hand-rolled SSE-frame reader over native `fetch` streaming — not `EventSource`, which can
   * neither POST a body nor carry the httpOnly session cookie the way a `credentials: 'include'`
   * fetch can (no client-side JS ever reads/writes it either way, ADR-0004). Parses the same
   * `event: <name>\ndata: <json>\n\n` frame shape `ChatController.sendMessage` writes.
   */
  async streamMessage(conversationId: string, text: string, callbacks: StreamMessageCallbacks): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => undefined);
        throw new ApiError(res.status, body);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd: number;
        while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const eventLine = frame.split('\n').find((l) => l.startsWith('event:'));
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice('event:'.length).trim();
          const data = JSON.parse(dataLine.slice('data:'.length).trim());

          if (event === 'token' && callbacks.onToken) callbacks.onToken(data.text);
          if (event === 'done') callbacks.onDone(data);
        }
      }
    } catch (err) {
      callbacks.onError(err);
    }
  },
};
