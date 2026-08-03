import { sniffFileType } from './magic-byte-sniff';

function docxLikeBuffer(marker: string): Buffer {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20), Buffer.from(marker, 'ascii')]);
}

describe('sniffFileType (sec §4.4 content-based validation)', () => {
  it('detects a PDF by its %PDF- signature', () => {
    expect(sniffFileType(Buffer.from('%PDF-1.7\n...'))).toBe('pdf');
  });

  it('detects a PNG by its 8-byte signature', () => {
    expect(sniffFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]))).toBe('png');
  });

  it('detects a JPEG by its FF D8 FF prefix', () => {
    expect(sniffFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe('jpg');
  });

  it('detects a DOCX: zip signature plus the word/ OOXML part marker', () => {
    expect(sniffFileType(docxLikeBuffer('word/document.xml'))).toBe('docx');
  });

  it('detects a DOCX via the [Content_Types].xml marker as an alternative', () => {
    expect(sniffFileType(docxLikeBuffer('[Content_Types].xml'))).toBe('docx');
  });

  it('rejects a generic zip that has the zip signature but no OOXML word marker', () => {
    expect(sniffFileType(docxLikeBuffer('some/other/file.txt'))).toBeNull();
  });

  it('rejects a renamed file whose extension lies about its actual content', () => {
    // A plain text file renamed to report.pdf — sniff must go by bytes, not the claimed name.
    expect(sniffFileType(Buffer.from('just plain text, not a real document'))).toBeNull();
  });

  it('rejects an empty buffer without throwing', () => {
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });

  it('rejects a truncated buffer shorter than any signature without throwing', () => {
    expect(sniffFileType(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});
