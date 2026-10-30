import { describe, expect, it } from 'vitest';
import { arenaFromLayout, flightBlocked, groundHeight, propBase, raycastArena, raycastGround } from './arena.js';
import { DEFAULT_GAME_CONFIG } from './config.js';
import { generateLayout } from './generate.js';
import { prop } from './layout-tools.js';
import { vec3 } from './math.js';
import { stepMovement } from './movement.js';
import { buildNavGrid, reachability } from './navigation.js';
import { type TerrainHill, buildHeightField, groundShape, hasTerrain, heightAt, slopeAt } from './terrain.js';
import type { WorldLayout } from './world.js';
import { checkWorld, playRulesOf } from './world-checks.js';

const layout = (parts: Partial<WorldLayout>): WorldLayout => ({
  halfWidth: 20,
  halfDepth: 20,
  theme: 'park',
  floor: 'grass',
  scatter: 0,
  regions: [],
  props: [],
  spawnPoints: [
    { x: -15, z: 0 },
    { x: 15, z: 0 },
  ],
  ...parts,
});

const hill = (parts: Partial<TerrainHill>): TerrainHill => ({ x: 0, z: 0, width: 16, depth: 16, rotation: 0, height: 3, plateau: 0, ...parts });

describe('terrain heights', () => {
  it('leaves worlds without terrain flat, with no height field', () => {
    const flat = layout({});
    expect(hasTerrain(flat)).toBe(false);
    expect(buildHeightField(flat)).toBeNull();
    expect(heightAt(null, 3, 4)).toBe(0);
    expect(hasTerrain(layout({ terrain: { relief: 0, scale: 30, seed: 1, symmetry: 'none' } }))).toBe(false);
  });

  it('raises a hill to its height in the middle, flat on a plateau and level ground beyond it', () => {
    const shape = groundShape(layout({ hills: [hill({ height: 3, plateau: 0.5 })] }));
    expect(shape(0, 0)).toBeCloseTo(3);
    expect(shape(3.9, 0)).toBeCloseTo(3); // inside the plateau (radius 8 × 0.5)
    expect(shape(6, 0)).toBeGreaterThan(0);
    expect(shape(6, 0)).toBeLessThan(3);
    expect(shape(8.1, 0)).toBe(0);
    expect(groundShape(layout({ hills: [hill({ height: -2 })] }))(0, 0)).toBeCloseTo(-2);
  });

  it('turns oval hills like props (a ridge turned 90° runs along z)', () => {
    const shape = groundShape(layout({ hills: [hill({ width: 20, depth: 4, rotation: 90 })] }));
    expect(shape(0, 8)).toBeGreaterThan(0.1);
    expect(shape(8, 0)).toBe(0);
  });

  it('reads the ground off the same triangles the client draws, matching the samples exactly', () => {
    const l = layout({ terrain: { relief: 3, scale: 12, seed: 5, symmetry: 'none' }, hills: [hill({ x: 4, z: -3 })] });
    const field = buildHeightField(l)!;
    const shape = groundShape(l);
    for (const [c, r] of [
      [0, 0],
      [7, 13],
      [field.cols, field.rows],
    ] as const) {
      const x = field.originX + c * field.cellX;
      const z = field.originZ + r * field.cellZ;
      expect(heightAt(field, x, z)).toBeCloseTo(shape(x, z), 9);
    }
    // Continuous across the diagonal and across cell edges.
    const x = field.originX + 5 * field.cellX;
    const z = field.originZ + 5 * field.cellZ;
    expect(heightAt(field, x + field.cellX * 0.5 - 1e-9, z + field.cellZ * 0.5)).toBeCloseTo(heightAt(field, x + field.cellX * 0.5 + 1e-9, z + field.cellZ * 0.5), 6);
    expect(heightAt(field, x - 1e-9, z + 0.3)).toBeCloseTo(heightAt(field, x + 1e-9, z + 0.3), 6);
  });

  it('is the same every time, and mirrored for symmetric terrain', () => {
    const quad = layout({ terrain: { relief: 4, scale: 15, seed: 9, symmetry: 'quad' } });
    expect(buildHeightField(quad)!.heights).toEqual(buildHeightField(quad)!.heights);
    const shape = groundShape(quad);
    for (const [x, z] of [
      [3, 7],
      [11.5, -2],
    ] as const) {
      expect(shape(-x, z)).toBeCloseTo(shape(x, z), 12);
      expect(shape(x, -z)).toBeCloseTo(shape(x, z), 12);
    }
    const mx = groundShape(layout({ terrain: { relief: 4, scale: 15, seed: 9, symmetry: 'mirror-x' } }));
    expect(mx(-6, 4)).toBeCloseTo(mx(6, 4), 12);
    expect(mx(6, -4)).not.toBeCloseTo(mx(6, 4), 3);
  });

  it('sets props on the lowest ground under their foot, and spawns on the ground', () => {
    const l = layout({ hills: [hill({ x: 0, z: 0, width: 20, depth: 20, height: 4 })], props: [prop('block', 4, 0, { width: 2, depth: 2 })], spawnPoints: [{ x: 2, z: 0 }, { x: 15, z: 0 }] });
    const arena = arenaFromLayout(l);
    expect(arena.colliders[0]!.base).toBeCloseTo(propBase(arena.ground, l.props[0]!));
    // The block spans x 3–5: its foot is the ground at its downhill (outer) edge.
    expect(arena.colliders[0]!.base).toBeLessThanOrEqual(groundHeight(arena, 5, 0));
    expect(arena.colliders[0]!.base).toBeGreaterThan(groundHeight(arena, 5, 0) - 0.2);
    expect(arena.colliders[0]!.base).toBeLessThan(groundHeight(arena, 4, 0));
    expect(arena.spawnPoints[0]!.y).toBeCloseTo(groundHeight(arena, 2, 0));
  });
});

describe('moving on terrain', () => {
  const cfg = DEFAULT_GAME_CONFIG;

  it('follows the ground up a gentle slope', () => {
    const arena = arenaFromLayout(layout({ hills: [hill({ width: 30, depth: 30, height: 3 })] }));
    let p = vec3(-12, groundHeight(arena, -12, 0), 0);
    for (let i = 0; i < 20; i++) p = stepMovement(p, { moveX: 1, moveZ: 0 }, 0.05, cfg, arena);
    expect(p.x).toBeCloseTo(-12 + cfg.playerSpeed);
    expect(p.y).toBeCloseTo(groundHeight(arena, p.x, p.z));
    expect(p.y).toBeGreaterThan(1);
  });

  it('cannot climb a slope steeper than the limit, but can walk down it', () => {
    // A 6 m mound 8 m across: far steeper than 40° on its sides.
    const arena = arenaFromLayout(layout({ hills: [hill({ width: 8, depth: 8, height: 6 })] }));
    let up = vec3(-6, 0, 0);
    for (let i = 0; i < 40; i++) up = stepMovement(up, { moveX: 1, moveZ: 0 }, 0.05, cfg, arena);
    expect(up.y).toBeLessThan(1);
    let down = vec3(0, 6, 0);
    for (let i = 0; i < 40; i++) down = stepMovement(down, { moveX: 1, moveZ: 0 }, 0.05, cfg, arena);
    expect(down.x).toBeGreaterThan(5);
    expect(down.y).toBeCloseTo(0);
  });

  it('slides along a steep ridge instead of stopping dead', () => {
    // A steep ridge along z; walking diagonally into it keeps the z part of the step.
    const arena = arenaFromLayout(layout({ hills: [hill({ x: 2, width: 3, depth: 30, height: 4 })] }));
    let p = vec3(0, 0, 0);
    for (let i = 0; i < 20; i++) p = stepMovement(p, { moveX: 1, moveZ: 1 }, 0.05, cfg, arena);
    expect(p.z).toBeGreaterThan(3);
    expect(p.y).toBeLessThan(1);
  });

  it('keeps bots off ground they cannot climb', () => {
    const arena = arenaFromLayout(layout({ hills: [hill({ width: 8, depth: 8, height: 6 })] }));
    expect(slopeAt(arena.ground, 2.5, 0)).toBeGreaterThan(1);
    const grid = buildNavGrid(arena, 0.5, cfg.maxSlopeDeg);
    const reach = reachability(grid, [{ x: -15, z: 0 }]);
    expect(reach.reachableShare).toBeGreaterThan(0.9);
    expect(reach.reachableShare).toBeLessThan(1);
  });
});

describe('throws over terrain', () => {
  it('a hill between two players stops a level throw; a hollow does not', () => {
    const between = arenaFromLayout(layout({ hills: [hill({ height: 2.5 })] }));
    const at = (x: number) => ({ x, y: groundHeight(between, x, 0) + 1.2, z: 0 });
    expect(flightBlocked(between, at(-12), at(12), 0.25)).toBe(true);
    const dip = arenaFromLayout(layout({ hills: [hill({ height: -2.5 })] }));
    expect(flightBlocked(dip, { x: -12, y: 1.2, z: 0 }, { x: 12, y: 1.2, z: 0 }, 0.25)).toBe(false);
  });

  it('counts a prop on high ground at its raised height', () => {
    const l = layout({ hills: [hill({ width: 30, depth: 30, height: 3 })], props: [prop('hedge', 0, 0, { width: 4, depth: 1, height: 0.9, rotation: 90 })] });
    const arena = arenaFromLayout(l);
    const y = groundHeight(arena, 0, 0);
    expect(flightBlocked(arena, { x: -3, y: y + 1.2, z: 0 }, { x: 3, y: y + 1.2, z: 0 }, 0.25)).toBe(false); // over the low hedge
    expect(flightBlocked(arena, { x: -3, y: y + 0.5, z: 0 }, { x: 3, y: y + 0.5, z: 0 }, 0.25)).toBe(true);
  });

  it('finds the ground under a ray, flat or rolling, and the first prop in the way', () => {
    const flat = arenaFromLayout(layout({}));
    expect(raycastGround(flat, vec3(0, 10, 0), vec3(0, -1, 0), 100)).toBeCloseTo(10);
    expect(raycastGround(flat, vec3(0, 10, 0), vec3(0, 1, 0), 100)).toBeNull();
    const hilly = arenaFromLayout(layout({ hills: [hill({ height: 3 })] }));
    expect(raycastGround(hilly, vec3(0, 10, 0), vec3(0, -1, 0), 100)).toBeCloseTo(7, 2);
    const s = Math.SQRT1_2;
    const t = raycastGround(hilly, vec3(-15, 8, 0), vec3(s, -s, 0), 100)!;
    expect(8 - s * t).toBeCloseTo(groundHeight(hilly, -15 + s * t, 0), 2);

    const walled = arenaFromLayout(layout({ props: [prop('wall', 5, 0, { width: 6, depth: 0.6, height: 2, rotation: 90 })] }));
    expect(raycastArena(walled, vec3(0, 1.5, 0), vec3(1, 0, 0), 30)).toBeCloseTo(4.7);
    expect(raycastArena(walled, vec3(0, 2.5, 0), vec3(1, 0, 0), 30)).toBe(30);
    const round = arenaFromLayout(layout({ props: [prop('pillar', 5, 0, { width: 2, height: 3 })] }));
    expect(raycastArena(round, vec3(0, 1, 0), vec3(1, 0, 0), 30)).toBeCloseTo(4);
  });
});

describe('generated terrain', () => {
  it('leaves layouts without relief exactly as before, and adds mirrored hills with it', () => {
    const options = { theme: 'park', width: 80, depth: 80, density: 0.5, symmetry: 'quad', spawns: 8, seed: 2 } as const;
    const flat = generateLayout(options);
    expect(flat.terrain).toBeUndefined();
    expect(flat.hills).toBeUndefined();
    const hilly = generateLayout({ ...options, relief: 1 });
    expect({ ...hilly, terrain: undefined, hills: undefined }).toEqual({ ...flat, terrain: undefined, hills: undefined });
    expect(hilly.terrain?.relief).toBeGreaterThan(0);
    const key = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`;
    const hills = new Set(hilly.hills!.map((h) => key(h.x, h.z)));
    for (const h of hilly.hills!) expect(hills.has(key(-h.x, -h.z))).toBe(true);
  });

  for (const seed of [1, 2, 3, 4]) {
    it(`seed ${seed}: hilly layouts stay climbable and connected`, () => {
      const l = generateLayout({ theme: 'park', width: 90, depth: 70, density: 0.6, symmetry: 'quad', spawns: 8, seed, relief: 1 });
      const result = checkWorld(l, playRulesOf(DEFAULT_GAME_CONFIG, 8));
      expect(result.unreachable).toEqual([]);
      expect(result.checks.some((c) => c.text.includes('cannot be reached'))).toBe(false);
    });
  }
});
