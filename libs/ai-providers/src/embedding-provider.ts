/**
 * ADR-0008's provider abstraction layer. `modelName` is stamped onto every
 * `Chunk.embeddingModel` — provenance a future re-embed migration (ADR-0010)
 * would key off, and what tells a mixed-provider tenant apart from a
 * consistently-embedded one.
 */
export interface EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** Already L2-normalized vectors in, so the dot product IS the cosine similarity — shared by `FakeEmbeddingProvider`'s own tests and `libs/retrieval`'s Fake ranking arm. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function l2Normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) return vector;
  return vector.map((v) => v / magnitude);
}

/** Deterministic string hash (djb2) — same input always maps to the same dimension/sign, no external dependency. */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0;
}

const DIMENSIONS = 768; // matches ADR-0002's pinned numDimensions, so a Fake-embedded corpus and a real one are index-shape-compatible

/**
 * Dev/CI binding (document-chat-rag plan §5) — no real language understanding,
 * but a stable, locally distance-preserving pseudo-embedding via the
 * feature-hashing trick: near-identical text lands near-identical vectors,
 * very different text lands far apart. Real semantic quality is exactly what
 * the ADR-0008 Hebrew benchmark gate measures, deliberately not attempted
 * here (see the plan's scope cuts) — this exists only to make retrieval
 * ranking *logic* (not quality) genuinely testable without live credentials.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = 'fake-hashed-768';
  readonly dimensions = DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array(DIMENSIONS).fill(0);
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const ngramSize = 3;

    if (normalized.length < ngramSize) {
      if (normalized.length > 0) {
        const hash = djb2Hash(normalized);
        vector[hash % DIMENSIONS] += 1;
      }
      return l2Normalize(vector);
    }

    for (let i = 0; i <= normalized.length - ngramSize; i++) {
      const ngram = normalized.slice(i, i + ngramSize);
      const hash = djb2Hash(ngram);
      const index = hash % DIMENSIONS;
      const sign = (hash & 1) === 0 ? 1 : -1;
      vector[index] += sign;
    }

    return l2Normalize(vector);
  }
}
