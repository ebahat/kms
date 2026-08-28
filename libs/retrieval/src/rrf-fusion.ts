/**
 * Reciprocal Rank Fusion (ADR-0002) — combines two independently-ranked
 * lists (semantic + keyword) into one ranking without needing their scores
 * to be on comparable scales. `k=60` is RRF's standard constant. Shared by
 * `FakeRetrievalProvider` (real Fake-path ranking, in-process) and (for the
 * real Atlas path, app-side per ADR-0002 rather than a server-side
 * `$rankFusion`) `AtlasRetrievalProvider`.
 */
export function reciprocalRankFusion<T>(rankedLists: T[][], keyOf: (item: T) => string, k = 60): T[] {
  const rrfScore = new Map<string, number>();
  const itemByKey = new Map<string, T>();

  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      const key = keyOf(item);
      itemByKey.set(key, item);
      rrfScore.set(key, (rrfScore.get(key) ?? 0) + 1 / (k + rank + 1));
    });
  }

  return [...rrfScore.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => itemByKey.get(key)!);
}
