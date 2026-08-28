export type Lang = 'he' | 'en' | 'mixed';

const HEBREW_RANGE = /[֐-׿]/g;
const LATIN_RANGE = /[A-Za-z]/g;

/**
 * Cheap heuristic (ratio of Hebrew-Unicode-range to Latin-range characters) —
 * no ML dependency needed at MVP fidelity. Feeds the chunk schema's `lang`
 * field, which the retrieval-fusion layer and the Hebrew-prefix-tolerant
 * Atlas Search analyzer both key off (ADR-0002).
 */
export function detectLang(text: string): Lang {
  const hebrewCount = (text.match(HEBREW_RANGE) ?? []).length;
  const latinCount = (text.match(LATIN_RANGE) ?? []).length;
  const total = hebrewCount + latinCount;
  if (total === 0) return 'en';
  const hebrewRatio = hebrewCount / total;
  if (hebrewRatio >= 0.85) return 'he';
  if (hebrewRatio <= 0.15) return 'en';
  return 'mixed';
}
