import { ChunkDocument, ChunksRepository, DocumentsRepository, toObjectId } from '@kms/data';
import { MIN_RELEVANCE_SCORE, RetrievalProvider, RetrievedChunk } from './retrieval-provider';
import { reciprocalRankFusion } from './rrf-fusion';

/**
 * Real Atlas Vector Search + Atlas Search binding (ADR-0002) — issues the
 * literal `$vectorSearch`/`$search` pipelines via `ChunksRepository`'s
 * Atlas-path methods, fuses both arms with the same RRF function the Fake
 * path uses. Unverified in this sandbox: no live Atlas cluster with the
 * `chunks_vector`/`chunks_text` indexes, and `mongodb-memory-server` cannot
 * execute either stage (document-chat-rag plan's scope cut) — flagged the
 * same way `AtlasStorageProvider`-equivalent real bindings are elsewhere in
 * this codebase.
 */
export class AtlasRetrievalProvider implements RetrievalProvider {
  constructor(
    private readonly chunks: ChunksRepository,
    private readonly documents: DocumentsRepository,
  ) {}

  async retrieve(query: { text: string; embedding: number[] }, permittedFolderIds: string[], limit: number): Promise<RetrievedChunk[]> {
    const folderObjectIds = permittedFolderIds.map(toObjectId);

    const [semanticRanked, keywordRanked] = await Promise.all([
      this.chunks.vectorSearchScoped(query.embedding, folderObjectIds, limit),
      this.chunks.textSearchScoped(query.text, folderObjectIds, limit),
    ]);

    const fused = reciprocalRankFusion<ChunkDocument & { score: number }>(
      [semanticRanked, keywordRanked],
      (c) => c._id.toString(),
    ).slice(0, limit);

    if (fused.length === 0) return [];

    // `reciprocalRankFusion` stores whichever list's object reference set a key last — for a chunk
    // present in both arms, that's `keywordRanked`'s BM25-scale score, not the semantic-arm's. Look
    // the real semantic score up separately for the relevance filter (and prefer it in the output)
    // rather than trust whatever `.score` happened to survive fusion. A chunk absent from the
    // semantic arm (keyword-only match) passes the filter unconditionally — an exact keyword hit is
    // its own relevance signal, not something to compare against a vector-similarity threshold.
    const semanticScoreByChunkId = new Map(semanticRanked.map((c) => [c._id.toString(), c.score]));
    const relevant = fused.filter((c) => {
      const semanticScore = semanticScoreByChunkId.get(c._id.toString());
      return semanticScore === undefined || semanticScore >= MIN_RELEVANCE_SCORE;
    });
    if (relevant.length === 0) return [];

    const documentNames = await this.resolveDocumentNames(relevant.map((c) => c.documentId.toString()));

    return relevant.map((c) => ({
      chunkId: c._id.toString(),
      documentId: c.documentId.toString(),
      documentName: documentNames.get(c.documentId.toString()) ?? 'מסמך',
      page: c.page,
      text: c.text,
      score: semanticScoreByChunkId.get(c._id.toString()) ?? c.score,
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
