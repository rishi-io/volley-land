import { type Bounds2, type Collider, colliderFromProp, footprintSamples, sphereHitsCollider } from './colliders.js';
import type { Vec3 } from './math.js';
import { type HeightField, buildHeightField, heightAt } from './terrain.js';
import type { WorldLayout, WorldProp } from './world.js';

/** Side of a broad-phase grid cell, in metres. */
const CELL = 4;

/** Which colliders touch each grid cell, so collision only checks nearby props. */
export interface ColliderGrid {
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  cells: readonly (readonly number[])[];
}

/** The collision view of a world, used by movement, hit detection, bots and navigation. */
export interface Arena {
  /** Playable floor spans [-halfWidth, halfWidth] × [-halfDepth, halfDepth] on X/Z. */
  halfWidth: number;
  halfDepth: number;
  colliders: readonly Collider[];
  spawnPoints: readonly Vec3[];
  grid: ColliderGrid;
  /** Ground heights; null on a flat world (height 0 everywhere). */
  ground: HeightField | null;
}

/** An arena from its parts (tests build open arenas this way). */
export function createArena(parts: {
  halfWidth: number;
  halfDepth: number;
  colliders?: readonly Collider[];
  spawnPoints?: readonly Vec3[];
  ground?: HeightField | null;
}): Arena {
  const colliders = parts.colliders ?? [];
  return {
    halfWidth: parts.halfWidth,
    halfDepth: parts.halfDepth,
    colliders,
    spawnPoints: parts.spawnPoints ?? [],
    grid: buildGrid(parts.halfWidth, parts.halfDepth, colliders),
    ground: parts.ground ?? null,
  };
}

/** Build the collision arena for an authored world layout (identical on server and client). */
export function arenaFromLayout(layout: WorldLayout): Arena {
  const ground = buildHeightField(layout);
  return createArena({
    halfWidth: layout.halfWidth,
    halfDepth: layout.halfDepth,
    colliders: layout.props.map((p) => colliderFromProp(p, propBase(ground, p))),
    spawnPoints: layout.spawnPoints.map((p) => ({ x: p.x, y: heightAt(ground, p.x, p.z), z: p.z })),
    ground,
  });
}

/** Ground height at a floor point. */
export const groundHeight = (arena: Arena, x: number, z: number): number => heightAt(arena.ground, x, z);

/**
 * Where a prop stands: the lowest ground under its foot, so on a slope it sinks into the uphill
 * side instead of floating on the downhill one. The client draws it at the same height.
 */
export function propBase(ground: HeightField | null, prop: WorldProp): number {
  if (!ground) return 0;
  return Math.min(...footprintSamples(prop).map((p) => heightAt(ground, p.x, p.z)));
}

function buildGrid(halfWidth: number, halfDepth: number, colliders: readonly Collider[]): ColliderGrid {
  const cols = Math.max(1, Math.ceil((halfWidth * 2) / CELL));
  const rows = Math.max(1, Math.ceil((halfDepth * 2) / CELL));
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  const grid = { originX: -halfWidth, originZ: -halfDepth, cols, rows, cells };
  colliders.forEach((c, i) => forEachCell(grid, c.bounds, (cell) => cells[cell]!.push(i)));
  return grid;
}

function forEachCell(grid: ColliderGrid, b: Bounds2, visit: (cell: number) => void): void {
  const col = (x: number) => Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.originX) / CELL)));
  const row = (z: number) => Math.min(grid.rows - 1, Math.max(0, Math.floor((z - grid.originZ) / CELL)));
  const c0 = col(b.minX);
  const c1 = col(b.maxX);
  const r0 = row(b.minZ);
  const r1 = row(b.maxZ);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) visit(r * grid.cols + c);
}

/** Colliders whose bounds may touch the given area, each once, in layout order. */
export function collidersNear(arena: Arena, area: Bounds2): Collider[] {
  const { grid, colliders } = arena;
  if (colliders.length === 0) return [];
  const seen = new Set<number>();
  forEachCell(grid, area, (cell) => {
    for (const i of grid.cells[cell]!) seen.add(i);
  });
  return [...seen]
    .sort((a, b) => a - b)
    .map((i) => colliders[i]!)
    .filter((c) => c.bounds.minX <= area.maxX && c.bounds.maxX >= area.minX && c.bounds.minZ <= area.maxZ && c.bounds.maxZ >= area.minZ);
}

/** Colliders near a circle on the floor. */
export const collidersAround = (arena: Arena, x: number, z: number, radius: number): Collider[] =>
  collidersNear(arena, { minX: x - radius, minZ: z - radius, maxX: x + radius, maxZ: z + radius });

/**
 * Whether a sphere of `radius` flying in a straight line from `from` to `to` touches a prop or the
 * ground on the way. Checked at steps no longer than the radius, so a fast throw cannot pass
 * through a thin wall between two ticks. Low props it flies over do not count, and neither does
 * ground it clears.
 */
export function flightBlocked(arena: Arena, from: Vec3, to: Vec3, radius: number): boolean {
  const minY = Math.min(from.y, to.y) - radius;
  const maxY = Math.max(from.y, to.y) + radius;
  const near = collidersNear(arena, {
    minX: Math.min(from.x, to.x) - radius,
    minZ: Math.min(from.z, to.z) - radius,
    maxX: Math.max(from.x, to.x) + radius,
    maxZ: Math.max(from.z, to.z) + radius,
  }).filter((c) => c.base + c.height > minY && c.base < maxY);
  const ground = arena.ground && minY < arena.ground.max ? arena.ground : null;
  if (near.length === 0 && !ground) return false;
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / radius));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    if (ground && y - radius < heightAt(ground, x, z)) return true;
    if (near.some((c) => sphereHitsCollider(c, x, y, z, radius))) return true;
  }
  return false;
}

/**
 * How far along a ray (unit `dir`) it first meets the ground, or null within `maxDistance`. The
 * third-person aim finds the point under the pointer with it.
 */
export function raycastGround(arena: Arena, origin: Vec3, dir: Vec3, maxDistance: number): number | null {
  const field = arena.ground;
  if (!field) {
    if (dir.y >= -1e-9) return null;
    const t = -origin.y / dir.y;
    return t >= 0 && t <= maxDistance ? t : null;
  }
  const below = (t: number) => origin.y + dir.y * t < heightAt(field, origin.x + dir.x * t, origin.z + dir.z * t);
  let start = 0;
  if (origin.y > field.max) {
    if (dir.y >= 0) return null;
    start = (origin.y - field.max) / -dir.y;
  }
  if (start > maxDistance) return null;
  if (below(start)) return start;
  const step = Math.min(field.cellX, field.cellZ) * 0.5;
  let previous = start;
  for (let t = start + step; previous < maxDistance; t += step) {
    const at = Math.min(t, maxDistance);
    if (below(at)) {
      // Narrow down the crossing between the last point above ground and this one.
      let lo = previous;
      let hi = at;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (below(mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    previous = at;
    if (dir.y >= 0 && origin.y + dir.y * at > field.max) return null;
  }
  return null;
}

/** Entry distance of a ray into a prop's solid (footprint × [base, base + height]), or null. */
export function rayHitsCollider(c: Collider, origin: Vec3, dir: Vec3): number | null {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  const slab = (o: number, d: number, min: number, max: number) => {
    if (Math.abs(d) < 1e-12) {
      if (o < min || o > max) far = -1;
      return;
    }
    let t1 = (min - o) / d;
    let t2 = (max - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
  };
  slab(origin.y, dir.y, c.base, c.base + c.height);
  const dx = origin.x - c.x;
  const dz = origin.z - c.z;
  if (c.shape === 'box') {
    // The same turn as colliders.ts toLocal.
    slab(dx * c.cos - dz * c.sin, dir.x * c.cos - dir.z * c.sin, -c.halfWidth, c.halfWidth);
    slab(dx * c.sin + dz * c.cos, dir.x * c.sin + dir.z * c.cos, -c.halfDepth, c.halfDepth);
  } else {
    const a = dir.x * dir.x + dir.z * dir.z;
    const b = 2 * (dx * dir.x + dz * dir.z);
    const k = dx * dx + dz * dz - c.radius * c.radius;
    if (a < 1e-12) {
      if (k > 0) return null;
    } else {
      const disc = b * b - 4 * a * k;
      if (disc < 0) return null;
      const root = Math.sqrt(disc);
      near = Math.max(near, (-b - root) / (2 * a));
      far = Math.min(far, (-b + root) / (2 * a));
    }
  }
  return near <= far && far >= 0 ? near : null;
}

/**
 * How far along a ray (unit `dir`) it first meets a prop or the ground, up to `maxDistance` (which
 * it returns when nothing is in the way). The first-person aim finds what the crosshair is on with it.
 */
export function raycastArena(arena: Arena, origin: Vec3, dir: Vec3, maxDistance: number): number {
  const end = { x: origin.x + dir.x * maxDistance, z: origin.z + dir.z * maxDistance };
  let best = raycastGround(arena, origin, dir, maxDistance) ?? maxDistance;
  const near = collidersNear(arena, {
    minX: Math.min(origin.x, end.x),
    minZ: Math.min(origin.z, end.z),
    maxX: Math.max(origin.x, end.x),
    maxZ: Math.max(origin.z, end.z),
  });
  for (const c of near) {
    const t = rayHitsCollider(c, origin, dir);
    if (t !== null && t < best) best = t;
  }
  return best;
}
