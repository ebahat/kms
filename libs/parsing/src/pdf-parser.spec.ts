import pdfParse from 'pdf-parse';
import { parsePdf } from './pdf-parser';

jest.mock('pdf-parse');

const mockedPdfParse = pdfParse as unknown as jest.Mock;

function withFakePages(pageTexts: string[]) {
  mockedPdfParse.mockImplementation(
    async (_buffer: Buffer, options: { pagerender: (p: { getTextContent: () => Promise<{ items: { str: string }[] }> }) => Promise<string> }) => {
      for (const text of pageTexts) {
        await options.pagerender({ getTextContent: () => Promise.resolve({ items: text ? [{ str: text }] : [] }) });
      }
      return { text: pageTexts.join('\n') };
    },
  );
}

describe('parsePdf', () => {
  beforeEach(() => mockedPdfParse.mockReset());

  it('returns one PageText per PDF page, 1-indexed', async () => {
    withFakePages(['first page content', 'second page content']);

    const result = await parsePdf(Buffer.from('fake'));

    expect(result.pages).toEqual([
      { page: 1, text: 'first page content' },
      { page: 2, text: 'second page content' },
    ]);
  });

  it('flags hasLowTextPages when a page has a near-empty text layer (a scanned page)', async () => {
    withFakePages(['a real page with plenty of extracted text', '']);

    const result = await parsePdf(Buffer.from('fake'));

    expect(result.hasLowTextPages).toBe(true);
  });

  it('does not flag hasLowTextPages when every page has a real text layer', async () => {
    withFakePages(['plenty of real extracted text here', 'and here too, plenty of text']);

    const result = await parsePdf(Buffer.from('fake'));

    expect(result.hasLowTextPages).toBe(false);
  });

  it('rejects a PDF exceeding the page ingestion ceiling', async () => {
    withFakePages(Array.from({ length: 2001 }, () => 'x'));

    await expect(parsePdf(Buffer.from('fake'))).rejects.toThrow(/page ingestion ceiling/);
  });
});
