import JSZip from 'jszip';
import mammoth from 'mammoth';
import { PageText } from './chunker';

/** DOCX is a zip container — both ceilings guard against a zip-bomb before mammoth ever touches the decompressed content (sec §4.4, ADR-0003). Numbers are generous relative to any legitimate document, deliberately conservative against an adversarial upload. */
const MAX_ZIP_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MB

export class ZipBombRejectedError extends Error {}

export type DocxGuardOpts = { maxZipEntries?: number; maxUncompressedBytes?: number };

/** Extracts plain text from a DOCX. DOCX has no fixed pagination without a real rendering engine, so `page` is always absent — the retrieval layer treats an absent page as "cite the document, not a page" (ADR-0002). */
export async function parseDocx(buffer: Buffer, guardOpts: DocxGuardOpts = {}): Promise<{ pages: PageText[] }> {
  await assertNotZipBomb(buffer, guardOpts);

  const { value: text } = await mammoth.extractRawText({ buffer });
  return { pages: [{ text }] };
}

async function assertNotZipBomb(buffer: Buffer, opts: DocxGuardOpts): Promise<void> {
  const maxEntries = opts.maxZipEntries ?? MAX_ZIP_ENTRIES;
  const maxBytes = opts.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;

  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > maxEntries) {
    throw new ZipBombRejectedError(`DOCX has ${entries.length} zip entries, exceeding the ${maxEntries} ceiling`);
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    // JSZip exposes the decompressed size on `_data`; walking every entry's decompressed
    // byte length up front (rather than after mammoth has already expanded it) is the point.
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    totalUncompressed += size;
    if (totalUncompressed > maxBytes) {
      throw new ZipBombRejectedError(`DOCX decompresses beyond the ${maxBytes}-byte ceiling`);
    }
  }
}
