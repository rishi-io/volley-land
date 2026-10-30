import { BUILTIN_WORLDS, arenaFromLayout, footprintContains } from '@volleyland/game-core';
import { describe, expect, it } from 'vitest';
import { decorPlacements, regionContains, sceneryPlacements, surfaceAt } from './scatter';
import { THEME_LOOKS } from './themes';

const park = BUILTIN_WORLDS.find((w) => w.id === 'maple-park')!.layout;

describe('world scatter', () => {
  it('finds the surface at a point from the topmost painted region', () => {
    expect(surfaceAt(park, 0, 0)).toBe('cobbles'); // the plaza
    expect(surfaceAt(park, 30, 30)).toBe('grass');
    const turned = { surface: 'sand' as const, shape: 'rect' as const, x: 0, z: 0, width: 10, depth: 2, rotation: 90 };
    expect(regionContains(turned, 0, 4.5)).toBe(true);
    expect(regionContains(turned, 4.5, 0)).toBe(false);
  });

  it('scatters decorations on the surfaces they belong to, clear of props, the same every time', () => {
    const arena = arenaFromLayout(park);
    const placed = decorPlacements(park, arena, THEME_LOOKS.park.decor);
    expect(placed).toEqual(decorPlacements(park, arena, THEME_LOOKS.park.decor));
    const tufts = placed.get('tuft') ?? [];
    expect(tufts.length).toBeGreaterThan(50);
    for (const t of tufts) expect(surfaceAt(park, t.x, t.z)).toBe('grass');
    for (const list of placed.values()) for (const p of list) expect(arena.colliders.some((c) => footprintContains(c, p.x, p.z))).toBe(false);
    expect(decorPlacements({ ...park, scatter: 0 }, arena, THEME_LOOKS.park.decor).size).toBe(0);
  });

  it('puts scenery outside the floor only', () => {
    const scenery = sceneryPlacements(park, THEME_LOOKS.park.scenery.kinds, THEME_LOOKS.park.scenery.density);
    const all = [...scenery.values()].flat();
    expect(all.length).toBeGreaterThan(20);
    for (const p of all) expect(Math.abs(p.x) > park.halfWidth || Math.abs(p.z) > park.halfDepth).toBe(true);
  });
});
