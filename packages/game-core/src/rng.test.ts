import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, shuffle } from './rng.js';

describe('rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
  });

  it('stays in [0, 1)', () => {
    const rng = createRng(hashSeed('match-1'));
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('shuffles deterministically without losing items', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const first = shuffle(items, createRng(7));
    expect(shuffle(items, createRng(7))).toEqual(first);
    expect([...first].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
