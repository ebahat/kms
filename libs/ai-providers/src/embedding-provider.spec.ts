import { cosineSimilarity, FakeEmbeddingProvider } from './embedding-provider';

describe('FakeEmbeddingProvider', () => {
  it('produces a 768-dim vector matching ADR-0002s pinned dimensionality', async () => {
    const provider = new FakeEmbeddingProvider();
    const [vector] = await provider.embed(['פרוטוקול ישיבת הנהלה מיום שני']);
    expect(vector).toHaveLength(768);
  });

  it('is deterministic — the same text always embeds to the same vector', async () => {
    const provider = new FakeEmbeddingProvider();
    const [a] = await provider.embed(['החלטה בדבר תקציב שנתי']);
    const [b] = await provider.embed(['החלטה בדבר תקציב שנתי']);
    expect(a).toEqual(b);
  });

  it('embeds near-identical text to a high-similarity vector', async () => {
    const provider = new FakeEmbeddingProvider();
    const [a] = await provider.embed(['ישיבת הנהלה מיום שני עסקה באישור התקציב השנתי']);
    const [b] = await provider.embed(['ישיבת הנהלה מיום שני עסקה באישור התקציב השנתי לשנה הקרובה']);

    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.6);
  });

  it('embeds very different text to a low-similarity vector', async () => {
    const provider = new FakeEmbeddingProvider();
    const [a] = await provider.embed(['פרוטוקול ישיבת הנהלה בנושא תקציב']);
    const [b] = await provider.embed(['מתכון עוגת שוקולד עם קרם וניל']);

    expect(cosineSimilarity(a, b)).toBeLessThan(0.3);
  });

  it('a real query ranks its own containing chunk above an unrelated one — the property retrieval fusion actually needs', async () => {
    const provider = new FakeEmbeddingProvider();
    const query = 'מתי אושר התקציב השנתי?';
    const relevantChunk = 'בישיבת ההנהלה מיום שני אושר התקציב השנתי ברוב קולות';
    const unrelatedChunk = 'החברה תעביר את המשרדים לכתובת חדשה בחודש הבא';

    const [queryVec] = await provider.embed([query]);
    const [relevantVec, unrelatedVec] = await provider.embed([relevantChunk, unrelatedChunk]);

    expect(cosineSimilarity(queryVec, relevantVec)).toBeGreaterThan(cosineSimilarity(queryVec, unrelatedVec));
  });

  it('handles very short/empty text without throwing', async () => {
    const provider = new FakeEmbeddingProvider();
    const [emptyVec, shortVec] = await provider.embed(['', 'הי']);
    expect(emptyVec).toHaveLength(768);
    expect(shortVec).toHaveLength(768);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical normalized vectors', () => {
    const v = [0.6, 0.8];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});
