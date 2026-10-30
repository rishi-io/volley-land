import {
  type Arena,
  type FloorRegion,
  type SurfaceId,
  type WorldLayout,
  collidersAround,
  createRng,
  footprintContains,
  groundHeight,
  hashSeed,
} from '@volleyland/game-core';
import type { DecorKind, DecorRule, SceneryKind } from './themes';

/** One instance to draw: where, how it is turned (radians) and sized, and which tint it takes. */
export interface Placement {
  x: number;
  /** Height of its foot: the ground under it (0 on flat ground). */
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  tint: number;
}

/** Whether a floor point lies in a painted region (a turned rectangle or ellipse). */
export function regionContains(r: FloorRegion, x: number, z: number): boolean {
  const a = (r.rotation * Math.PI) / 180;
  const dx = x - r.x;
  const dz = z - r.z;
  const lx = dx * Math.cos(a) - dz * Math.sin(a);
  const lz = dx * Math.sin(a) + dz * Math.cos(a);
  const u = lx / (r.width / 2);
  const v = lz / (r.depth / 2);
  return r.shape === 'rect' ? Math.abs(u) <= 1 && Math.abs(v) <= 1 : u * u + v * v <= 1;
}

/** The surface showing at a floor point: the topmost region there, else the floor. */
export function surfaceAt(layout: WorldLayout, x: number, z: number): SurfaceId {
  for (let i = layout.regions.length - 1; i >= 0; i--) {
    const r = layout.regions[i]!;
    if (regionContains(r, x, z)) return r.surface;
  }
  return layout.floor;
}

/** A seed from the layout's shape, so the same world always gets the same scatter. */
const seedOf = (layout: WorldLayout, salt: string) =>
  hashSeed(`${salt}:${layout.theme}:${layout.halfWidth}:${layout.halfDepth}:${layout.props.length}:${layout.regions.length}`);

/** Decorations per square metre of floor at full scatter. */
const DECOR_DENSITY = 0.09;
const MAX_DECOR = 2500;

/**
 * Where to put the theme's floor decorations: spread over the floor at `layout.scatter`
 * density, each on a surface its rule allows, clear of props and spawn points.
 */
export function decorPlacements(layout: WorldLayout, arena: Arena, rules: readonly DecorRule[]): Map<DecorKind, Placement[]> {
  const out = new Map<DecorKind, Placement[]>();
  if (rules.length === 0 || layout.scatter <= 0) return out;
  const rng = createRng(seedOf(layout, 'decor'));
  const area = layout.halfWidth * 2 * layout.halfDepth * 2;
  const count = Math.min(MAX_DECOR, Math.round(area * DECOR_DENSITY * layout.scatter));
  for (let i = 0; i < count; i++) {
    const x = (rng() * 2 - 1) * (layout.halfWidth - 0.3);
    const z = (rng() * 2 - 1) * (layout.halfDepth - 0.3);
    const roll = rng();
    const yaw = rng() * Math.PI * 2;
    const size = 0.75 + rng() * 0.5;
    const tint = Math.floor(rng() * 8);
    const surface = surfaceAt(layout, x, z);
    const allowed = rules.filter((r) => !r.on || r.on.includes(surface));
    if (allowed.length === 0) continue;
    if (collidersAround(arena, x, z, 0.4).some((c) => footprintContains(c, x, z, 0.25))) continue;
    if (layout.spawnPoints.some((s) => Math.hypot(s.x - x, s.z - z) < 1.2)) continue;
    const total = allowed.reduce((sum, r) => sum + r.weight, 0);
    let pick = roll * total;
    const rule = allowed.find((r) => (pick -= r.weight) <= 0) ?? allowed[allowed.length - 1]!;
    if (rule.chance !== undefined && size > 0.75 + rule.chance * 0.5) continue; // reuse the size roll: no extra draw
    const list = out.get(rule.kind) ?? [];
    list.push({ x, y: groundHeight(arena, x, z), z, yaw, sx: size, sy: size, sz: size, tint });
    out.set(rule.kind, list);
  }
  return out;
}

/** How far scenery reaches beyond the floor edge, in metres. */
export const SCENERY_BAND = { near: 3, far: 30 };

/**
 * Scenery round the outside of the floor (trees beyond the fence, buildings across the road),
 * spaced so pieces do not overlap, standing on the ground there (`ground`; level when omitted).
 * Purely for looks: players cannot leave the floor.
 */
export function sceneryPlacements(layout: WorldLayout, kinds: readonly SceneryKind[], density: number, ground: (x: number, z: number) => number = () => 0): Map<SceneryKind, Placement[]> {
  const out = new Map<SceneryKind, Placement[]>();
  if (kinds.length === 0 || density <= 0) return out;
  const rng = createRng(seedOf(layout, 'scenery'));
  const ow = layout.halfWidth + SCENERY_BAND.far;
  const od = layout.halfDepth + SCENERY_BAND.far;
  const iw = layout.halfWidth + SCENERY_BAND.near;
  const id = layout.halfDepth + SCENERY_BAND.near;
  const area = 4 * (ow * od - iw * id);
  const target = Math.round(area * density);
  const placed: { x: number; z: number; r: number }[] = [];
  for (let attempt = 0; attempt < target * 8 && placed.length < target; attempt++) {
    const x = (rng() * 2 - 1) * ow;
    const z = (rng() * 2 - 1) * od;
    const kind = kinds[Math.floor(rng() * kinds.length)]!;
    const big = kind === 'building';
    const yaw = big ? Math.atan2(-x, -z) : rng() * Math.PI * 2;
    const size = big ? 1 : 0.8 + rng() * 0.6;
    const r = big ? 10 : 2 * size;
    const inner = big ? 10 : 0;
    if (Math.abs(x) < iw + inner && Math.abs(z) < id + inner) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) continue;
    placed.push({ x, z, r });
    const list = out.get(kind) ?? [];
    list.push({ x, y: ground(x, z), z, yaw, sx: size, sy: size, sz: size, tint: Math.floor(rng() * 8) });
    out.set(kind, list);
  }
  return out;
}
