import { chunkPages } from './chunker';

describe('chunkPages', () => {
  it('keeps a short page as a single chunk', () => {
    const chunks = chunkPages([{ page: 1, text: 'פסקה קצרה אחת.' }]);
    expect(chunks).toEqual([{ seq: 0, page: 1, text: 'פסקה קצרה אחת.' }]);
  });

  it('splits on paragraph boundaries before overflowing the target size', () => {
    const paraA = 'a'.repeat(1200);
    const paraB = 'b'.repeat(1200);
    const chunks = chunkPages([{ page: 1, text: `${paraA}\n\n${paraB}` }], { targetChars: 2000, overlapRatio: 0 });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe(paraA);
    expect(chunks[1].text).toBe(paraB);
  });

  it('hard-cuts a single paragraph that exceeds the target on its own, with overlap between the cut pieces', () => {
    const hugeParagraph = 'x'.repeat(1000);
    const chunks = chunkPages([{ page: 1, text: hugeParagraph }], { targetChars: 400, overlapRatio: 0.1 });

    expect(chunks.length).toBeGreaterThan(1);
    // consecutive pieces overlap by ~40 chars (10% of 400)
    const overlap = chunks[0].text.slice(-40);
    expect(chunks[1].text.startsWith(overlap)).toBe(true);
  });

  it('never spans two pages in one chunk', () => {
    const chunks = chunkPages([
      { page: 1, text: 'תוכן עמוד ראשון.' },
      { page: 2, text: 'תוכן עמוד שני.' },
    ]);

    expect(chunks.map((c) => c.page)).toEqual([1, 2]);
  });

  it('assigns a single running seq counter across all pages', () => {
    const chunks = chunkPages([
      { page: 1, text: 'א'.repeat(1500) },
      { page: 2, text: 'ב'.repeat(1500) },
    ]);

    expect(chunks.map((c) => c.seq)).toEqual(chunks.map((_, i) => i));
  });

  it('produces no chunks for an empty/whitespace-only page', () => {
    const chunks = chunkPages([{ page: 1, text: '   \n\n  ' }]);
    expect(chunks).toEqual([]);
  });

  it('leaves page undefined when the source has no page concept (DOCX)', () => {
    const chunks = chunkPages([{ text: 'תוכן ללא מספור עמודים.' }]);
    expect(chunks[0].page).toBeUndefined();
  });
});
