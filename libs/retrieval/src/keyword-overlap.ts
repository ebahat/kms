/** Cheap tokenizer — lowercased, punctuation stripped, whitespace-split. Good enough for a token-overlap keyword-arm score; a real BM25/Hebrew-analyzer arm is exactly what `AtlasRetrievalProvider`'s `$search` stage provides instead. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'()[\]{}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Count of query tokens present in the candidate text — simple, deterministic, enough to prove the fusion logic ranks exact-term matches sensibly without a real BM25 implementation. */
export function tokenOverlapScore(candidateText: string, queryTokens: string[]): number {
  const candidateTokens = new Set(tokenize(candidateText));
  return queryTokens.reduce((count, t) => count + (candidateTokens.has(t) ? 1 : 0), 0);
}
