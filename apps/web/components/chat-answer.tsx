'use client';

import type { Citation } from '../lib/chat-api';

/**
 * Purpose-built renderer, NOT a general-purpose markdown/HTML library — deliberately, this is what
 * satisfies sec §5.2's "text formatting only, no images, no HTML, no remote loads" requirement by
 * construction rather than by sanitizing a general renderer's output after the fact. Supports only
 * paragraph breaks and `**bold**`; never uses `dangerouslySetInnerHTML`.
 *
 * Citations render as a "מקורות" (sources) chip list below the answer, not as inline markers — the
 * chat providers (`libs/ai-providers`) return prose plus a separate citations array, not marker
 * positions within the text, so this is the honest rendering of what's actually generated rather
 * than a heuristic guess at where a citation belongs in the sentence.
 */
export function ChatAnswer({ content, citations, onCitationClick }: { content: string; citations: Citation[]; onCitationClick?: (citation: Citation) => void }) {
  const paragraphs = content.split(/\n{2,}/).filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {paragraphs.map((para, i) => (
          <p key={i} className="font-body-md text-body-md text-on-surface whitespace-pre-wrap leading-relaxed">
            {renderInlineBold(para)}
          </p>
        ))}
      </div>

      {citations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="font-label-xs text-label-xs text-on-surface-variant">מקורות:</span>
          {citations.map((c) => (
            <button
              key={c.chunkId}
              type="button"
              onClick={() => onCitationClick?.(c)}
              className="flex items-center gap-1 px-2 py-1 rounded-DEFAULT bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-xs text-label-xs transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">description</span>
              {c.documentName}
              {c.page !== undefined && <span className="text-on-surface-variant">· עמ׳ {c.page}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Splits on `**bold**` markers only — no other markdown syntax is recognized, deliberately. */
function renderInlineBold(text: string): (string | JSX.Element)[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
