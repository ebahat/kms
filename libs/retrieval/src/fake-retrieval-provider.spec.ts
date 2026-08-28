import { newObjectId } from '@kms/data';
import { FakeEmbeddingProvider } from '@kms/ai-providers';
import { FakeRetrievalProvider } from './fake-retrieval-provider';

type ObjectId = ReturnType<typeof newObjectId>;

function makeChunk(overrides: Partial<{ _id: ObjectId; documentId: ObjectId; folderId: ObjectId; page?: number; text: string; embedding: number[] }>) {
  return {
    _id: newObjectId(),
    documentId: newObjectId(),
    folderId: newObjectId(),
    text: 'x',
    embedding: [0],
    ...overrides,
  } as any;
}

describe('FakeRetrievalProvider', () => {
  const folderId = newObjectId();
  const embedder = new FakeEmbeddingProvider();

  it('returns [] when there are no candidate chunks in scope', async () => {
    const chunks = { findByScope: jest.fn().mockResolvedValue([]) } as any;
    const documents = { findById: jest.fn() } as any;
    const provider = new FakeRetrievalProvider(chunks, documents);

    const result = await provider.retrieve({ text: 'שאלה', embedding: [0.1] }, [folderId.toString()], 5);

    expect(result).toEqual([]);
  });

  it('ranks the chunk that actually contains the query text above an unrelated one, and resolves document names', async () => {
    const relevantDocId = newObjectId();
    const unrelatedDocId = newObjectId();
    const relevantText = 'התקציב השנתי אושר בישיבת ההנהלה';
    const unrelatedText = 'מתכון עוגת שוקולד עם קרם וניל';

    const [queryEmbedding] = await embedder.embed(['מה קרה עם התקציב השנתי?']);
    const [relevantEmbedding] = await embedder.embed([relevantText]);
    const [unrelatedEmbedding] = await embedder.embed([unrelatedText]);

    const relevantChunk = makeChunk({ documentId: relevantDocId, folderId, text: relevantText, embedding: relevantEmbedding });
    const unrelatedChunk = makeChunk({ documentId: unrelatedDocId, folderId, text: unrelatedText, embedding: unrelatedEmbedding });

    const chunks = { findByScope: jest.fn().mockResolvedValue([unrelatedChunk, relevantChunk]) } as any;
    const documents = {
      findById: jest.fn((id: ObjectId) => {
        if (id.equals(relevantDocId)) return Promise.resolve({ name: 'פרוטוקול הנהלה.pdf' });
        if (id.equals(unrelatedDocId)) return Promise.resolve({ name: 'מתכונים.pdf' });
        return Promise.resolve(null);
      }),
    } as any;
    const provider = new FakeRetrievalProvider(chunks, documents);

    const result = await provider.retrieve({ text: 'מה קרה עם התקציב השנתי?', embedding: queryEmbedding }, [folderId.toString()], 5);

    expect(result[0].documentId).toBe(relevantDocId.toString());
    expect(result[0].documentName).toBe('פרוטוקול הנהלה.pdf');
  });

  it('respects the limit', async () => {
    const [sharedEmbedding] = await embedder.embed(['ישיבת הנהלה בנושא תקציב שנתי']);
    const chunkList = Array.from({ length: 5 }, (_, i) => makeChunk({ folderId, text: `chunk ${i}`, embedding: sharedEmbedding }));
    const chunks = { findByScope: jest.fn().mockResolvedValue(chunkList) } as any;
    const documents = { findById: jest.fn().mockResolvedValue({ name: 'doc' }) } as any;
    const provider = new FakeRetrievalProvider(chunks, documents);

    const result = await provider.retrieve({ text: 'ישיבת הנהלה בנושא תקציב שנתי', embedding: sharedEmbedding }, [folderId.toString()], 2);

    expect(result).toHaveLength(2);
  });

  it('falls back to a generic document name when the document cannot be resolved', async () => {
    const [embedding] = await embedder.embed(['תוכן המסמך']);
    const chunk = makeChunk({ folderId, text: 'תוכן המסמך', embedding });
    const chunks = { findByScope: jest.fn().mockResolvedValue([chunk]) } as any;
    const documents = { findById: jest.fn().mockResolvedValue(null) } as any;
    const provider = new FakeRetrievalProvider(chunks, documents);

    const result = await provider.retrieve({ text: 'תוכן המסמך', embedding }, [folderId.toString()], 5);

    expect(result[0].documentName).toBe('מסמך');
  });

  describe('relevance threshold (MIN_RELEVANCE_SCORE — PRD §10\'s "not found" applies to unanswerable questions, not only permission gaps)', () => {
    it('drops a chunk whose semantic similarity to the query falls below the threshold, even though it exists in an accessible folder', async () => {
      const [queryEmbedding] = await embedder.embed(['מה אושר בישיבת ההנהלה בנוגע לתקציב השנתי?']);
      const unrelatedText = 'מה מזג האוויר מחר בתל אביב?'; // live-verification finding: an irrelevant-but-permitted question must not still "answer" from an unrelated chunk
      const [unrelatedEmbedding] = await embedder.embed([unrelatedText]);
      const chunk = makeChunk({ folderId, text: unrelatedText, embedding: unrelatedEmbedding });
      const chunks = { findByScope: jest.fn().mockResolvedValue([chunk]) } as any;
      const documents = { findById: jest.fn() } as any;
      const provider = new FakeRetrievalProvider(chunks, documents);

      const result = await provider.retrieve({ text: 'ישיבת הנהלה תקציב', embedding: queryEmbedding }, [folderId.toString()], 5);

      expect(result).toEqual([]);
      expect(documents.findById).not.toHaveBeenCalled(); // no name resolution wasted on a chunk that's about to be discarded
    });

    it('keeps a chunk whose semantic similarity meets the threshold', async () => {
      const relevantText = 'ישיבת ההנהלה מיום שני אישרה תקציב שנתי בסך שני מיליון שקלים';
      const [queryEmbedding] = await embedder.embed(['מה אושר בישיבת ההנהלה בנוגע לתקציב השנתי?']);
      const [relevantEmbedding] = await embedder.embed([relevantText]);
      const chunk = makeChunk({ folderId, text: relevantText, embedding: relevantEmbedding });
      const chunks = { findByScope: jest.fn().mockResolvedValue([chunk]) } as any;
      const documents = { findById: jest.fn().mockResolvedValue({ name: 'פרוטוקול.pdf' }) } as any;
      const provider = new FakeRetrievalProvider(chunks, documents);

      const result = await provider.retrieve({ text: 'מה אושר בישיבת ההנהלה בנוגע לתקציב השנתי?', embedding: queryEmbedding }, [folderId.toString()], 5);

      expect(result).toHaveLength(1);
    });
  });
});
