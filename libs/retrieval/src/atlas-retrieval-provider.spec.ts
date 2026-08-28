import { newObjectId } from '@kms/data';
import { AtlasRetrievalProvider } from './atlas-retrieval-provider';

describe('AtlasRetrievalProvider (pipeline wiring — the real $vectorSearch/$search calls themselves are unverified, no live Atlas cluster in this sandbox)', () => {
  const folderId = newObjectId();
  const documentId = newObjectId();

  it('returns [] without resolving any document names when both search arms return nothing', async () => {
    const chunks = { vectorSearchScoped: jest.fn().mockResolvedValue([]), textSearchScoped: jest.fn().mockResolvedValue([]) } as any;
    const documents = { findById: jest.fn() } as any;
    const provider = new AtlasRetrievalProvider(chunks, documents);

    const result = await provider.retrieve({ text: 'שאלה', embedding: [0.1] }, [folderId.toString()], 5);

    expect(result).toEqual([]);
    expect(documents.findById).not.toHaveBeenCalled();
  });

  it('calls both the vector and text search arms scoped to the permitted folders, fuses, and resolves document names', async () => {
    const chunkId = newObjectId();
    const hit = { _id: chunkId, documentId, folderId, text: 'תוכן', score: 0.87 };
    const chunks = {
      vectorSearchScoped: jest.fn().mockResolvedValue([hit]),
      textSearchScoped: jest.fn().mockResolvedValue([hit]),
    } as any;
    const documents = { findById: jest.fn().mockResolvedValue({ name: 'פרוטוקול.pdf' }) } as any;
    const provider = new AtlasRetrievalProvider(chunks, documents);

    const result = await provider.retrieve({ text: 'שאלה', embedding: [0.1, 0.2] }, [folderId.toString()], 5);

    expect(chunks.vectorSearchScoped).toHaveBeenCalledWith([0.1, 0.2], [folderId], 5);
    expect(chunks.textSearchScoped).toHaveBeenCalledWith('שאלה', [folderId], 5);
    expect(result).toEqual([{ chunkId: chunkId.toString(), documentId: documentId.toString(), documentName: 'פרוטוקול.pdf', page: undefined, text: 'תוכן', score: 0.87 }]);
  });

  describe('relevance threshold (MIN_RELEVANCE_SCORE)', () => {
    it('drops a chunk whose semantic-arm score falls below the threshold, even if the vector search returned it', async () => {
      const chunkId = newObjectId();
      const lowScoreHit = { _id: chunkId, documentId, folderId, text: 'תוכן לא רלוונטי', score: 0.05 };
      const chunks = { vectorSearchScoped: jest.fn().mockResolvedValue([lowScoreHit]), textSearchScoped: jest.fn().mockResolvedValue([]) } as any;
      const documents = { findById: jest.fn() } as any;
      const provider = new AtlasRetrievalProvider(chunks, documents);

      const result = await provider.retrieve({ text: 'שאלה לא קשורה', embedding: [0.1] }, [folderId.toString()], 5);

      expect(result).toEqual([]);
      expect(documents.findById).not.toHaveBeenCalled();
    });

    it('keeps a keyword-only match (absent from the semantic arm) regardless of the threshold — an exact keyword hit is its own relevance signal', async () => {
      const chunkId = newObjectId();
      const keywordOnlyHit = { _id: chunkId, documentId, folderId, text: 'מכיל את המילה המדויקת', score: 4.2 }; // BM25-scale score, not comparable to a cosine threshold
      const chunks = { vectorSearchScoped: jest.fn().mockResolvedValue([]), textSearchScoped: jest.fn().mockResolvedValue([keywordOnlyHit]) } as any;
      const documents = { findById: jest.fn().mockResolvedValue({ name: 'מסמך.pdf' }) } as any;
      const provider = new AtlasRetrievalProvider(chunks, documents);

      const result = await provider.retrieve({ text: 'המילה המדויקת', embedding: [0.1] }, [folderId.toString()], 5);

      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(4.2); // no semantic-arm score to prefer, falls back to the fused (keyword-arm) score
    });
  });
});
