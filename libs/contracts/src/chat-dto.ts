import { z } from 'zod';

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid id');

/** No body fields today (title defaults server-side — auto-titling is a deliberate scope cut, document-chat-rag plan). Kept as a schema, not an empty check, so a future field addition doesn't require touching the controller's parse call. */
export const CreateConversationRequestSchema = z.object({});
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

/** 4,000-char cap — a denial-of-wallet input-size guard (sec §5.5), independent of the per-user rate limit. */
export const SendMessageRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

/** Server-constructed only, from retrieval metadata — never parsed from the chat model's own output (sec §5.1, ADR-0008). */
export type Citation = {
  chunkId: string;
  documentId: string;
  documentName: string;
  page?: number;
};

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChatMessageSummary = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  ts: Date;
};

export type DeleteConversationResponse = { deleted: true };
