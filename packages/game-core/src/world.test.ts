import { describe, expect, it } from 'vitest';
import { arenaFromLayout, collidersAround, createArena, flightBlocked, groundHeight } from './arena.js';
import { DEFAULT_GAME_CONFIG } from './config.js';
import { BUILTIN_WORLDS, DEFAULT_WORLD_ID, PROTOTYPE_WORLD } from './builtin-worlds.js';
import { boxCollider, colliderFromProp, footprintContains, pushCircleOut, sphereHitsCollider } from './colliders.js';
import { generateLayout } from './generate.js';
import { applySymmetry, prop } from './layout-tools.js';
import { buildNavGrid, findPath, reachability, walkable } from './navigation.js';
import { PROPS, PROP_KINDS, THEMES, THEME_INFO, type WorldLayout, propExtent } from './world.js';

const layout = (parts: Partial<WorldLayout>): WorldLayout => ({
  halfWidth: 10,
  halfDepth: 10,
  theme: 'classic',
  floor: 'court',
  scatter: 0,
  regions: [],
  props: [],
  spawnPoints: [
    { x: -5, z: 0 },
    { x: 5, z: 0 },
  ],
  ...parts,
});

describe('colliders', () => {
  it('turn boxes the way three.js turns them (rotation.y)', () => {
    // A 4 × 1 wall turned 90°: three.js maps local +x to world −z, so the wall runs along z.
    const wall = colliderFromProp(prop('wall', 0, 0, { width: 4, depth: 1, rotation: 90 }));
    expect(footprintContains(wall, 0, 1.9)).toBe(true);
    expect(footprintContains(wall, 1.9, 0)).toBe(false);
    expect(wall.bounds.maxZ).toBeCloseTo(2);
    expect(wall.bounds.maxX).toBeCloseTo(0.5);
  });

  it('push a player circle out of a turned box along its face', () => {
    const box = boxCollider(0, 0, 2, 0.5, 1, Math.cos(Math.PI / 4), Math.sin(Math.PI / 4));
    const out = pushCircleOut(box, 0.1, 0.1, 0.5)!;
    expect(footprintContains(box, out.x, out.z, 0.5 - 1e-6)).toBe(false);
    expect(pushCircleOut(box, 5, 5, 0.5)).toBeNull();
  });

  it('push out of circles, and leave the centre point along +x', () => {
    const rock = colliderFromProp(prop('rock', 0, 0, { width: 2 }));
    expect(pushCircleOut(rock, 0, 0.5, 0.5)).toEqual({ x: 0, z: 1.5 });
    expect(pushCircleOut(rock, 0, 0, 0.5)).toEqual({ x: 1.5, z: 0 });
  });

  it('let throws pass over low props and hit tall ones', () => {
    const hedge = colliderFromProp(prop('hedge', 0, 0, { height: 0.9 }));
    const wall = colliderFromProp(prop('wall', 0, 0, { height: 2 }));
    expect(sphereHitsCollider(hedge, 0, 1.2, 0, 0.25)).toBe(false);
    expect(sphereHitsCollider(wall, 0, 1.2, 0, 0.25)).toBe(true);
    expect(sphereHitsCollider(wall, 0, 1.2, 0.5, 0.25)).toBe(true); // 0.2 m from the face
    expect(sphereHitsCollider(wall, 0, 1.2, 0.5, 0.15)).toBe(false);
  });
});

describe('arena', () => {
  it('builds colliders and spawn points from a layout', () => {
    const arena = arenaFromLayout(layout({ props: [prop('block', 2, -3, { width: 4, depth: 2 })] }));
    expect(arena.colliders[0]!.bounds).toEqual({ minX: 0, minZ: -4, maxX: 4, maxZ: -2 });
    expect(arena.spawnPoints).toEqual([
      { x: -5, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ]);
  });

  it('finds only nearby colliders, in layout order', () => {
    const props = [prop('rock', -40, -40), prop('rock', 3, 0), prop('rock', 0, 0), prop('rock', 40, 40)];
    const arena = arenaFromLayout(layout({ halfWidth: 50, halfDepth: 50, props }));
    expect(collidersAround(arena, 1, 0, 2).map((c) => c.x)).toEqual([3, 0]);
    expect(collidersAround(arena, 40, 40, 1).map((c) => c.x)).toEqual([40]);
    expect(collidersAround(createArena({ halfWidth: 5, halfDepth: 5 }), 0, 0, 3)).toEqual([]);
  });
});

describe('navigation', () => {
  // A wall across the middle with one gap at the top.
  const walled = arenaFromLayout(
    layout({ props: [prop('wall', 0, -2, { width: 16, depth: 1, rotation: 90 })], spawnPoints: [{ x: -6, z: 0 }, { x: 6, z: 0 }] }),
  );
  const grid = buildNavGrid(walled, 0.5);

  it('routes round cover through the gap', () => {
    const path = findPath(grid, { x: -6, z: -4 }, { x: 6, z: -4 });
    expect(path.length).toBeGreaterThan(1);
    expect(Math.max(...path.map((p) => p.z))).toBeGreaterThan(6);
    let from = { x: -6, z: -4 };
    for (const p of path) {
      expect(walkable(grid, from, p)).toBe(true);
      from = p;
    }
    expect(walkable(grid, { x: -6, z: -4 }, { x: 6, z: -4 })).toBe(false);
  });

  it('finds spawn points and floor walled off from the first spawn', () => {
    expect(reachability(grid, walled.spawnPoints).cutOffSpawns).toEqual([]);
    const sealed = arenaFromLayout(layout({ props: [prop('wall', 0, 0, { width: 20, depth: 1, rotation: 90 })] }));
    const result = reachability(buildNavGrid(sealed, 0.5), sealed.spawnPoints);
    expect(result.cutOffSpawns).toEqual([1]);
    expect(result.reachableShare).toBeLessThan(0.6);
  });
});

describe('symmetry', () => {
  it('mirrors positions and reverses turns, without copying items on the mirror line', () => {
    const items = applySymmetry([prop('wall', 4, 6, { rotation: 30 }), prop('rock', 0, 6)], 'quad');
    expect(items.map((p) => [p.x, p.z, p.rotation])).toEqual([
      [4, 6, 30],
      [-4, 6, 330],
      [4, -6, 330],
      [-4, -6, 30],
      [0, 6, 0],
      [0, -6, 0],
    ]);
  });
});

describe('built-in worlds', () => {
  it('has unique IDs, including the default and the prototype court', () => {
    const ids = BUILTIN_WORLDS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_WORLD_ID);
    expect(ids).toContain(PROTOTYPE_WORLD.id);
  });

  for (const world of BUILTIN_WORLDS) {
    it(`${world.name}: props on the floor, spawns clear, everywhere reachable`, () => {
      const { layout: l } = world;
      for (const p of l.props) {
        const e = propExtent(p);
        expect(Math.abs(p.x) + e.x, `${p.kind} at ${p.x},${p.z}`).toBeLessThanOrEqual(l.halfWidth);
        expect(Math.abs(p.z) + e.z, `${p.kind} at ${p.x},${p.z}`).toBeLessThanOrEqual(l.halfDepth);
      }
      const arena = arenaFromLayout(l);
      for (const s of l.spawnPoints) expect(arena.colliders.some((c) => footprintContains(c, s.x, s.z, 1))).toBe(false);
      const reach = reachability(buildNavGrid(arena, 0.5, DEFAULT_GAME_CONFIG.maxSlopeDeg), l.spawnPoints);
      expect(reach.cutOffSpawns).toEqual([]);
      expect(reach.reachableShare).toBeGreaterThan(0.999);
      // No spawn point in another's line of fire with the default rules (the small Phase 0 court predates this).
      if (world.id === PROTOTYPE_WORLD.id) return;
      const { projectileSpeed, projectileLifetimeMs, projectileHeight, projectileRadius } = DEFAULT_GAME_CONFIG;
      const range = projectileSpeed * (projectileLifetimeMs / 1000);
      for (const [i, a] of l.spawnPoints.entries()) {
        for (const [j, b] of l.spawnPoints.entries()) {
          if (j <= i || Math.hypot(a.x - b.x, a.z - b.z) > range) continue;
          const from = { ...a, y: groundHeight(arena, a.x, a.z) + projectileHeight };
          const to = { ...b, y: groundHeight(arena, b.x, b.z) + projectileHeight };
          expect(flightBlocked(arena, from, to, projectileRadius), `spawns ${i + 1} and ${j + 1}`).toBe(true);
        }
      }
    });
  }
});

describe('generateLayout', () => {
  it('is deterministic for a seed and different for another', () => {
    const options = { theme: 'park', width: 80, depth: 60, density: 0.6, symmetry: 'quad', spawns: 8, seed: 7 } as const;
    expect(generateLayout(options)).toEqual(generateLayout(options));
    expect(generateLayout({ ...options, seed: 8 })).not.toEqual(generateLayout(options));
  });

  for (const theme of THEMES) {
    it(`${THEME_INFO[theme].name}: uses the theme's props, keeps spawns clear and the floor connected`, () => {
      const l = generateLayout({ theme, width: 90, depth: 70, density: 0.8, symmetry: 'mirror-x', spawns: 6, seed: 3 });
      expect(l.props.length).toBeGreaterThan(20);
      expect(l.spawnPoints).toHaveLength(6);
      for (const p of l.props) expect(Object.keys(THEME_INFO[theme].props)).toContain(p.kind);
      const arena = arenaFromLayout(l);
      const reach = reachability(buildNavGrid(arena, 0.5), l.spawnPoints);
      expect(reach.cutOffSpawns).toEqual([]);
      expect(reach.reachableShare).toBeGreaterThan(0.99);
    });
  }

  it('produces mirror-image layouts for symmetric options', () => {
    const l = generateLayout({ theme: 'snow', width: 60, depth: 60, density: 0.7, symmetry: 'quad', spawns: 8, seed: 11 });
    const key = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`;
    const positions = new Set(l.props.map((p) => key(p.x, p.z)));
    for (const p of l.props) expect(positions.has(key(-p.x, -p.z))).toBe(true);
  });
});

describe('prop catalogue', () => {
  it('describes every kind, with circle props as wide as they are deep', () => {
    expect(Object.keys(PROPS).sort()).toEqual([...PROP_KINDS].sort());
    for (const kind of PROP_KINDS) {
      if (PROPS[kind].shape === 'circle') expect(PROPS[kind].size.width).toBe(PROPS[kind].size.depth);
    }
  });
});
