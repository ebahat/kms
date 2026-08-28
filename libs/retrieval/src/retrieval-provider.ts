import { GroundingChunk } from '@kms/ai-providers';

/** Everything citation construction needs, plus a ranking score — the controller (Part 2 Task 5) builds citations directly from this, never from the chat model's own output (sec §5.1). */
export type RetrievedChunk = GroundingChunk & { score: number };

/**
 * A candidate below this semantic-similarity score is treated as irrelevant, not just
 * low-ranked — dropped before the chat provider ever sees it. Without this, a permitted-but-
 * unrelated question (found live: "what's the weather tomorrow?" against a corpus about a budget
 * meeting) still returns whatever chunk exists as if it answered the question, since retrieval on
 * its own has no floor — only the empty-permission case was fail-closed before this. PRD §10's
 * "not found" requirement is about the ANSWER not existing in the corpus, not only about the user
 * lacking permission; this is what makes that half of the requirement real.
 *
 * The number itself is a rough placeholder, not a calibrated value — real calibration is exactly
 * what the ADR-0008 Hebrew benchmark gate (test plan §4.2's `not-found` dataset) is for, and that
 * gate hasn't run (document-chat-rag plan's scope cut). 0.15 is chosen conservatively against the
 * Fake embedding provider's own measured behavior (`embedding-provider.spec.ts`: near-identical
 * text scores > 0.6, clearly unrelated text scores < 0.3) — low enough not to reject a real but
 * loosely-worded match, high enough to reject genuinely unrelated content.
 */
export const MIN_RELEVANCE_SCORE = 0.15;

export interface RetrievalProvider {
  retrieve(query: { text: string; embedding: number[] }, permittedFolderIds: string[], limit: number): Promise<RetrievedChunk[]>;
}
