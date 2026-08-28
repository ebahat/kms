/**
 * The exact retrieval metadata a grounded answer was built from — the same
 * shape `libs/retrieval`'s `RetrievedChunk` carries. Deliberately a local
 * type here (not imported from `libs/retrieval`): dependency direction is
 * `libs/retrieval` → `libs/ai-providers` (retrieval consumes an
 * `EmbeddingProvider`), never the reverse.
 *
 * Citations are NEVER built from this interface's output text (sec §5.1,
 * ADR-0008's prompt architecture) — the chat controller (Part 2 Task 5)
 * constructs them directly from the `groundingChunks` list it already has,
 * independent of whatever the model generated. `ChatProvider` only ever
 * returns prose tokens and mechanically-derived follow-ups, never anything
 * resembling a citation.
 */
export type GroundingChunk = {
  chunkId: string;
  documentId: string;
  documentName: string;
  page?: number;
  text: string;
};

export type ChatAnswerEvent = { type: 'token'; text: string } | { type: 'done'; followUps: string[] };

/**
 * ADR-0008's provider abstraction layer, chat half. Streaming by design
 * (PRD §10) — an `AsyncGenerator` maps directly onto the controller's SSE
 * `event: token` / `event: done` frames (Part 2 Task 5) without another
 * translation layer in between.
 */
export interface ChatProvider {
  readonly modelName: string;
  generateAnswer(input: { question: string; groundingChunks: GroundingChunk[] }): AsyncGenerator<ChatAnswerEvent>;
}
