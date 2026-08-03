/**
 * File-type detection by content, never by extension or client-declared
 * Content-Type (sec §4.4, PRD §8 — PDF/DOCX/JPG/PNG only). A renamed or
 * mislabeled file is caught here: the sniffed type is the only thing the
 * upload path trusts.
 */
export type SniffedFileType = 'pdf' | 'docx' | 'jpg' | 'png';

export const MIME_TYPES: Record<SniffedFileType, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  png: 'image/png',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const ZIP_LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('ascii') === '%PDF-';
}

function isPng(buf: Buffer): boolean {
  return buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function isJpg(buf: Buffer): boolean {
  return buf.subarray(0, JPG_SIGNATURE.length).equals(JPG_SIGNATURE);
}

/**
 * DOCX is a ZIP container — the local-file-header bytes alone don't
 * distinguish it from a plain zip, XLSX, or PPTX (which use `xl/`/`ppt/`
 * instead). Requiring the `word/` OOXML part name in the sniffed bytes is a
 * real, if not airtight, improvement over signature-only checking.
 */
function isDocx(buf: Buffer): boolean {
  if (!buf.subarray(0, ZIP_LOCAL_FILE_HEADER.length).equals(ZIP_LOCAL_FILE_HEADER)) return false;
  return buf.includes('word/') || buf.includes('[Content_Types].xml');
}

export function sniffFileType(buffer: Buffer): SniffedFileType | null {
  if (isPdf(buffer)) return 'pdf';
  if (isPng(buffer)) return 'png';
  if (isJpg(buffer)) return 'jpg';
  if (isDocx(buffer)) return 'docx';
  return null;
}
