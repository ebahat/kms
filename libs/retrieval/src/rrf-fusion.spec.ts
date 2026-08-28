import { reciprocalRankFusion } from './rrf-fusion';

describe('reciprocalRankFusion', () => {
  it('ranks an item appearing near the top of both lists above one appearing in only one list', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c'], ['a', 'c', 'b']], (x) => x);
    expect(fused[0]).toBe('a');
  });

  it('boosts an item that appears in both lists over one that appears only in a single list at rank 0', () => {
    const listA = ['x', 'shared'];
    const listB = ['shared', 'y'];
    const fused = reciprocalRankFusion([listA, listB], (i) => i);
    expect(fused[0]).toBe('shared');
  });

  it('returns items sorted strictly by descending fused score', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c']], (x) => x);
    expect(fused).toEqual(['a', 'b', 'c']);
  });

  it('handles an empty list gracefully', () => {
    expect(reciprocalRankFusion([[], []], (x: string) => x)).toEqual([]);
  });

  it('works with object items keyed by an id field', () => {
    const objA = { id: '1', v: 'A' };
    const objB = { id: '2', v: 'B' };
    const fused = reciprocalRankFusion([[objA, objB], [objB, objA]], (o) => o.id);
    expect(fused).toHaveLength(2);
    expect(new Set(fused.map((o) => o.id))).toEqual(new Set(['1', '2']));
  });
});
