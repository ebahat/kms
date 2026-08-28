import JSZip from 'jszip';
import mammoth from 'mammoth';
import { parseDocx, ZipBombRejectedError } from './docx-parser';

jest.mock('mammoth');

describe('parseDocx', () => {
  beforeEach(() => {
    (mammoth.extractRawText as jest.Mock) = jest.fn().mockResolvedValue({ value: 'טקסט לדוגמה מתוך המסמך' });
  });

  it('extracts plain text with no page concept', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<xml/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await parseDocx(buffer);

    expect(result.pages).toEqual([{ text: 'טקסט לדוגמה מתוך המסמך' }]);
  });

  it('rejects a zip with too many entries before ever calling mammoth', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 5; i++) zip.file(`f${i}.txt`, 'x');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(parseDocx(buffer, { maxZipEntries: 3 })).rejects.toThrow(ZipBombRejectedError);
    expect(mammoth.extractRawText).not.toHaveBeenCalled();
  });

  it('rejects a zip whose decompressed size exceeds the ceiling before ever calling mammoth', async () => {
    const zip = new JSZip();
    zip.file('big.txt', 'a'.repeat(10_000));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(parseDocx(buffer, { maxUncompressedBytes: 1_000 })).rejects.toThrow(ZipBombRejectedError);
    expect(mammoth.extractRawText).not.toHaveBeenCalled();
  });

  it('accepts a zip within both ceilings', async () => {
    const zip = new JSZip();
    zip.file('small.txt', 'hello');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(parseDocx(buffer, { maxZipEntries: 10, maxUncompressedBytes: 10_000 })).resolves.toEqual({
      pages: [{ text: 'טקסט לדוגמה מתוך המסמך' }],
    });
  });
});
