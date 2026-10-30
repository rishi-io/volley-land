import type { Symmetry } from './layout-tools.js';
import { clamp } from './math.js';

/*
 * Ground height. A world may roll (seeded noise over the whole floor) and carry authored hills,
 * hollows and ridges. Server and client turn a layout into the same HeightField and read heights
 * from it the same way, so movement, throws, sight lines and what is drawn all agree.
 *
 * Only arithmetic and Math.sqrt (exactly rounded everywhere) go into the noise, so every engine
 * computes the same heights. A hill's turn uses cos/sin once per hill, which can differ in the
 * last bit between engines: far too little to matter, and prediction is reconciled anyway.
 */

/** Rolling ground over the whole floor. */
export interface WorldTerrain {
  /** How much the ground rolls: roughly the height between low and high ground, in metres. 0 is flat. */
  relief: number;
  /** Typical distance from one rise to the next, in metres. */
  scale: number;
  /** Picks the pattern; the same seed always gives the same ground. */
  seed: number;
  /** Mirror the rolling ground like the props, so no side has the high ground. */
  symmetry: Symmetry;
}

/** A raised (height > 0) or sunken (height < 0) mound: round or oval, turned, optionally flat-topped. */
export interface TerrainHill {
  x: number;
  z: number;
  /** Footprint, in metres (an ellipse this wide and deep). */
  width: number;
  depth: number;
  /** Degrees, counter-clockwise seen from above, like props. */
  rotation: number;
  /** Metres above (or below, when negative) the ground round it. */
  height: number;
  /** Share of the radius that is flat on top, 0–0.9: 0 is a smooth dome, 0.8 a mesa. */
  plateau: number;
}

export const DEFAULT_TERRAIN: Readonly<WorldTerrain> = Object.freeze({ relief: 0, scale: 30, seed: 1, symmetry: 'quad' });

/** The ground parts of a layout (the rest of WorldLayout does not change heights). */
export interface GroundLayout {
  halfWidth: number;
  halfDepth: number;
  terrain?: WorldTerrain;
  hills?: readonly TerrainHill[];
}

/** Whether a layout has any ground shape at all (flat worlds skip every height lookup). */
export const hasTerrain = (layout: GroundLayout): boolean => (layout.terrain?.relief ?? 0) > 0 || (layout.hills?.length ?? 0) > 0;

/* ---------- the height function ---------- */

/** An integer hash of a lattice point, in [0, 1). */
function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth value noise in [0, 1]. */
function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);
  const a = hash(x0, z0, seed);
  const b = hash(x0 + 1, z0, seed);
  const c = hash(x0, z0 + 1, seed);
  const d = hash(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

/**
 * Three octaves of value noise, in [0, 1] (mostly 0.2–0.8). The finer octaves are kept faint, so
 * the ground rolls instead of turning bumpy and steep.
 */
const fbm = (x: number, z: number, seed: number) =>
  (valueNoise(x, z, seed) + 0.35 * valueNoise(x * 2 + 17.3, z * 2 - 9.1, seed + 1) + 0.12 * valueNoise(x * 4 - 3.7, z * 4 + 5.9, seed + 2)) / 1.47;

/** |v| with the corner rounded off, so mirrored ground has no crease along the mirror line. */
const FOLD = 1.5;
const fold = (v: number) => Math.sqrt(v * v + FOLD * FOLD) - FOLD;

interface PreparedHill {
  x: number;
  z: number;
  cos: number;
  sin: number;
  invHalfWidth: number;
  invHalfDepth: number;
  height: number;
  plateau: number;
  /** Axis-aligned reach, to skip hills far from a point. */
  reach: number;
}

/** A height function for a layout's ground (analytic, unbounded: the scenery round the floor uses it too). */
export function groundShape(layout: GroundLayout): (x: number, z: number) => number {
  const terrain = layout.terrain;
  const relief = terrain?.relief ?? 0;
  const scale = Math.max(1, terrain?.scale ?? DEFAULT_TERRAIN.scale);
  const seed = terrain?.seed ?? 1;
  const symmetry = terrain?.symmetry ?? 'none';
  const foldX = symmetry === 'mirror-x' || symmetry === 'quad';
  const foldZ = symmetry === 'mirror-z' || symmetry === 'quad';
  const hills: PreparedHill[] = (layout.hills ?? []).map((h) => {
    const a = (h.rotation * Math.PI) / 180;
    return {
      x: h.x,
      z: h.z,
      cos: Math.cos(a),
      sin: Math.sin(a),
      invHalfWidth: 2 / Math.max(0.01, h.width),
      invHalfDepth: 2 / Math.max(0.01, h.depth),
      height: h.height,
      plateau: clamp(h.plateau, 0, 0.95),
      reach: Math.max(h.width, h.depth) / 2,
    };
  });
  return (x, z) => {
    let y = 0;
    if (relief > 0) {
      const nx = (foldX ? fold(x) : x) / scale;
      const nz = (foldZ ? fold(z) : z) / scale;
      y = relief * (fbm(nx, nz, seed) - 0.5) * 2;
    }
    for (const h of hills) {
      const dx = x - h.x;
      const dz = z - h.z;
      if (Math.abs(dx) > h.reach || Math.abs(dz) > h.reach) continue;
      // The same turn as props and regions (three.js rotation.y).
      const u = (dx * h.cos - dz * h.sin) * h.invHalfWidth;
      const v = (dx * h.sin + dz * h.cos) * h.invHalfDepth;
      const r = Math.sqrt(u * u + v * v);
      if (r >= 1) continue;
      const s = r <= h.plateau ? 0 : (r - h.plateau) / (1 - h.plateau);
      y += h.height * (1 - s * s * (3 - 2 * s));
    }
    return y;
  };
}

/* ---------- the height field ---------- */

/**
 * The ground sampled on a grid over the floor. Heights between samples are read off the same two
 * triangles per cell that the client draws, so a player stands exactly on the ground they see.
 */
export interface HeightField {
  originX: number;
  originZ: number;
  cellX: number;
  cellZ: number;
  cols: number;
  rows: number;
  /** (cols + 1) × (rows + 1) samples, row by row along +z. */
  heights: Float64Array;
  min: number;
  max: number;
}

/** About this many cells along the longer side, between half a metre and a metre each. */
const TARGET_CELLS = 200;

/** Grid cell size for a floor: shared by the height field and the drawn ground beyond the floor. */
export function terrainCellSize(halfWidth: number, halfDepth: number): number {
  return clamp((Math.max(halfWidth, halfDepth) * 2) / TARGET_CELLS, 0.5, 1);
}

/** The height field of a layout, or null when the ground is flat. */
export function buildHeightField(layout: GroundLayout): HeightField | null {
  if (!hasTerrain(layout)) return null;
  const shape = groundShape(layout);
  const cell = terrainCellSize(layout.halfWidth, layout.halfDepth);
  const cols = Math.max(1, Math.ceil((layout.halfWidth * 2) / cell));
  const rows = Math.max(1, Math.ceil((layout.halfDepth * 2) / cell));
  const cellX = (layout.halfWidth * 2) / cols;
  const cellZ = (layout.halfDepth * 2) / rows;
  const heights = new Float64Array((cols + 1) * (rows + 1));
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const h = shape(-layout.halfWidth + c * cellX, -layout.halfDepth + r * cellZ);
      heights[r * (cols + 1) + c] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { originX: -layout.halfWidth, originZ: -layout.halfDepth, cellX, cellZ, cols, rows, heights, min, max };
}

/**
 * Ground height at a floor point (0 on flat ground). Points off the floor take the height at the
 * nearest edge. Each cell is split along its (1, 0)–(0, 1) diagonal, like the drawn mesh.
 */
export function heightAt(field: HeightField | null, x: number, z: number): number {
  if (!field) return 0;
  const gx = clamp((x - field.originX) / field.cellX, 0, field.cols);
  const gz = clamp((z - field.originZ) / field.cellZ, 0, field.rows);
  const c = Math.min(field.cols - 1, Math.floor(gx));
  const r = Math.min(field.rows - 1, Math.floor(gz));
  const fx = gx - c;
  const fz = gz - r;
  const stride = field.cols + 1;
  const i = r * stride + c;
  const h = field.heights;
  if (fx + fz <= 1) {
    const a = h[i]!;
    return a + (h[i + 1]! - a) * fx + (h[i + stride]! - a) * fz;
  }
  const d = h[i + stride + 1]!;
  return d + (h[i + stride]! - d) * (1 - fx) + (h[i + 1]! - d) * (1 - fz);
}

/** Steepness of the ground at a point, as rise over run (0 is level, 1 is 45°), from the heights half a cell either side. */
export function slopeAt(field: HeightField | null, x: number, z: number): number {
  if (!field) return 0;
  const dx = field.cellX / 2;
  const dz = field.cellZ / 2;
  const sx = (heightAt(field, x + dx, z) - heightAt(field, x - dx, z)) / (2 * dx);
  const sz = (heightAt(field, x, z + dz) - heightAt(field, x, z - dz)) / (2 * dz);
  return Math.hypot(sx, sz);
}

/** The steepest climb a slope limit allows, as rise over run. */
export const climbLimit = (maxSlopeDeg: number): number => Math.tan((clamp(maxSlopeDeg, 0, 89) * Math.PI) / 180);
