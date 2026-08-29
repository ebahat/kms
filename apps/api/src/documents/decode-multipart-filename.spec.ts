import { decodeMultipartFilename } from './decode-multipart-filename';

describe('decodeMultipartFilename (2026-08-29 bug fix — Hebrew filenames rendered as mojibake)', () => {
  it('recovers a Hebrew filename mis-decoded as latin1 by busboy', () => {
    const original = 'דוח רבעוני.pdf';
    const mojibake = Buffer.from(original, 'utf8').toString('latin1');

    expect(decodeMultipartFilename(mojibake)).toBe(original);
  });

  it('is a no-op for an ASCII filename', () => {
    expect(decodeMultipartFilename('report.pdf')).toBe('report.pdf');
  });
});
