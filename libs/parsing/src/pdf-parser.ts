import pdfParse from 'pdf-parse';
import { PageText } from './chunker';

/** No legitimate document needs this many pages — a hard ceiling against a degenerate/adversarial upload, on top of the stage-level 5-minute parse timeout (ADR-0003). */
const MAX_PAGES = 2000;

export type PdfParseResult = {
  pages: PageText[];
  /** True when at least one page's extracted-chars-per-page fell below the OCR-routing threshold — the caller (parse stage) routes those pages to OCR instead of trusting this text layer (ADR-0003's parse→ocr fork). This pass doesn't build the OCR branch; such pages simply contribute no text. */
  hasLowTextPages: boolean;
};

/** Below this, a page is treated as having no real text layer (a scanned page saved as PDF) rather than a short-but-real page. */
const LOW_TEXT_CHARS_PER_PAGE = 20;

/** Extracts per-page text from a real text-layer PDF via pdf.js's text content API (through pdf-parse's `pagerender` hook, the standard way to preserve page boundaries — pdf-parse's own top-level `text` field concatenates all pages together). */
export async function parsePdf(buffer: Buffer): Promise<PdfParseResult> {
  const pages: string[] = [];

  await pdfParse(buffer, {
    pagerender: (pageData: { getTextContent: () => Promise<{ items: { str: string }[] }> }) =>
      pageData.getTextContent().then((textContent) => {
        const text = textContent.items.map((item) => item.str).join(' ');
        pages.push(text);
        return text;
      }),
  });

  if (pages.length > MAX_PAGES) {
    throw new Error(`PDF exceeds the ${MAX_PAGES}-page ingestion ceiling (${pages.length} pages)`);
  }

  let hasLowTextPages = false;
  const result: PageText[] = pages.map((text, i) => {
    if (text.trim().length < LOW_TEXT_CHARS_PER_PAGE) hasLowTextPages = true;
    return { page: i + 1, text };
  });

  return { pages: result, hasLowTextPages };
}
