import { ChunkDocument, ChunksRepository, DocumentsRepository, toObjectId } from '@kms/data';
import { cosineSimilarity } from '@kms/ai-providers';
import { MIN_RELEVANCE_SCORE, RetrievalProvider, RetrievedChunk } from './retrieval-provider';
import { reciprocalRankFusion } from './rrf-fusion';
import { tokenize, tokenOverlapScore } from './keyword-overlap';

/**
 * Dev/CI binding (document-chat-rag plan §1) — a REAL Mongo read
 * (`ChunksRepository.findByScope`, tenant+folder scoped) feeding brute-force
 * cosine similarity (semantic arm) + token-overlap (keyword arm), fused via
 * the exact same RRF function the real Atlas path uses. Only the ANN/BM25
 * ranking math is faked; the write side and the scoped-read side are real
 * and fully tested against `mongodb-memory-server`.
 */
export class FakeRetrievalProvider implements RetrievalProvider {
  constructor(
    private readonly chunks: ChunksRepository,
    private readonly documents: DocumentsRepository,
  ) {}

  async retrieve(query: { text: string; embedding: number[] }, permittedFolderIds: string[], limit: number): Promise<RetrievedChunk[]> {
    const folderObjectIds = permittedFolderIds.map(toObjectId);
    const candidates = await this.chunks.findByScope(folderObjectIds);
    if (candidates.length === 0) return [];

    const semanticRanked = [...candidates].sort((a, b) => cosineSimilarity(query.embedding, b.embedding) - cosineSimilarity(query.embedding, a.embedding));

    const queryTokens = tokenize(query.text);
    const keywordRanked = [...candidates].sort((a, b) => tokenOverlapScore(b.text, queryTokens) - tokenOverlapScore(a.text, queryTokens));

    const fused = reciprocalRankFusion<ChunkDocument>(
      [semanticRanked, keywordRanked],
      (c) => c._id.toString(),
    ).slice(0, limit);

    const relevant = fused.filter((c) => cosineSimilarity(query.embedding, c.embedding) >= MIN_RELEVANCE_SCORE);
    if (relevant.length === 0) return [];

    const documentNames = await this.resolveDocumentNames(relevant.map((c) => c.documentId.toString()));

    return relevant.map((c) => ({
      chunkId: c._id.toString(),
      documentId: c.documentId.toString(),
      documentName: documentNames.get(c.documentId.toString()) ?? 'מסמך',
      page: c.page,
      text: c.text,
      score: cosineSimilarity(query.embedding, c.embedding),
    }));
  }

  private async resolveDocumentNames(documentIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(documentIds)];
    const names = new Map<string, string>();
    for (const id of unique) {
      const doc = await this.documents.findById(toObjectId(id));
      if (doc) names.set(id, doc.name);
    }
    return names;
  }
}
