import { describe, expect, it } from 'vitest';
import { ACCESSORIES, DEFAULT_PALETTE, lookOf } from './appearance.js';

describe('lookOf', () => {
  it('gives every look in a full room a different colour-and-accessory pair', () => {
    for (const size of [4, 5, 8, 12]) {
      const palette = DEFAULT_PALETTE.slice(0, Math.min(size, DEFAULT_PALETTE.length));
      const pairs = new Set(Array.from({ length: 16 }, (_, look) => Object.values(lookOf(look, palette)).join()));
      expect(pairs.size, `palette of ${palette.length}`).toBe(16);
    }
  });

  it('cycles colours first and uses only known accessories', () => {
    expect(lookOf(0, DEFAULT_PALETTE).color).toBe(DEFAULT_PALETTE[0]);
    expect(lookOf(1, DEFAULT_PALETTE).color).toBe(DEFAULT_PALETTE[1]);
    for (let look = 0; look < 32; look++) expect(ACCESSORIES).toContain(lookOf(look, DEFAULT_PALETTE).accessory);
  });
});
