export type PageText = { page?: number; text: string };
export type TextChunk = { seq: number; page?: number; text: string };

/** ~500 tokens at a ~4-chars/token proxy — no real tokenizer dependency needed for MVP chunk sizing. */
const DEFAULT_TARGET_CHARS = 2000;
/** 10-15% overlap between adjacent chunks — keeps a mid-sentence answer from losing context at a chunk boundary. */
const DEFAULT_OVERLAP_RATIO = 0.12;

/**
 * Deterministic, paragraph-first splitter (document-chat-rag plan §4).
 * Chunks never span pages — page mapping (ADR-0002) requires each chunk to
 * belong to exactly one source page (or none, for DOCX). `seq` is a single
 * running counter across the whole document, giving a stable citation order.
 */
export function chunkPages(pages: PageText[], opts: { targetChars?: number; overlapRatio?: number } = {}): TextChunk[] {
  const targetChars = opts.targetChars ?? DEFAULT_TARGET_CHARS;
  const overlapChars = Math.round(targetChars * (opts.overlapRatio ?? DEFAULT_OVERLAP_RATIO));
  const chunks: TextChunk[] = [];
  let seq = 0;

  for (const page of pages) {
    const paragraphs = page.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    let buffer = '';

    const flush = () => {
      if (buffer) {
        chunks.push({ seq: seq++, page: page.page, text: buffer });
        buffer = '';
      }
    };

    for (const para of paragraphs) {
      if (para.length > targetChars) {
        flush();
        let start = 0;
        while (start < para.length) {
          const end = Math.min(start + targetChars, para.length);
          chunks.push({ seq: seq++, page: page.page, text: para.slice(start, end) });
          if (end >= para.length) break;
          start = end - overlapChars;
        }
        continue;
      }

      const candidate = buffer ? `${buffer}\n\n${para}` : para;
      if (candidate.length > targetChars && buffer) {
        const overlapTail = buffer.slice(Math.max(0, buffer.length - overlapChars));
        chunks.push({ seq: seq++, page: page.page, text: buffer });
        buffer = overlapTail ? `${overlapTail}\n\n${para}` : para;
      } else {
        buffer = candidate;
      }
    }
    flush();
  }

  return chunks;
}
