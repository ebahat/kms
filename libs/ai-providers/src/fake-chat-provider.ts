import { ChatAnswerEvent, ChatProvider, GroundingChunk } from './chat-provider';

const NOT_FOUND_MESSAGE = 'לא נמצא מידע בנושא זה במסמכים הזמינים לך.';

/**
 * Dev/CI binding (document-chat-rag plan §5) — no real LLM call, but proves
 * the full contract end to end: fail-closed "not found" when there's
 * nothing to ground on, a deterministic answer stitched from the retrieved
 * chunks otherwise, streamed as real token events, plus mechanically-derived
 * follow-ups. Real semantic quality is exactly what the ADR-0008 Hebrew
 * benchmark gate would measure — deliberately not attempted here (plan scope
 * cut), same status as `FakeEmbeddingProvider`.
 */
export class FakeChatProvider implements ChatProvider {
  readonly modelName = 'fake-chat-echo';

  async *generateAnswer(input: { question: string; groundingChunks: GroundingChunk[] }): AsyncGenerator<ChatAnswerEvent> {
    if (input.groundingChunks.length === 0) {
      yield* this.streamTokens(NOT_FOUND_MESSAGE);
      yield { type: 'done', followUps: [] };
      return;
    }

    const top = input.groundingChunks.slice(0, 2);
    const answer = `על סמך המסמכים הזמינים: ${top.map((c) => c.text).join(' ')}`;
    yield* this.streamTokens(answer);

    const followUps = this.mechanicalFollowUps(input.groundingChunks);
    yield { type: 'done', followUps };
  }

  private async *streamTokens(text: string): AsyncGenerator<ChatAnswerEvent> {
    for (const word of text.split(' ')) {
      yield { type: 'token', text: `${word} ` };
    }
  }

  /** No curated UX — a fixed mechanical derivation from retrieved-document metadata (plan scope cut), enough to prove the contract shape a real provider plugs into later. */
  private mechanicalFollowUps(chunks: GroundingChunk[]): string[] {
    const distinctDocumentNames = [...new Set(chunks.map((c) => c.documentName))].slice(0, 2);
    return distinctDocumentNames.map((name) => `האם תרצה לדעת עוד מתוך "${name}"?`);
  }
}
