import { type Arena, collidersAround } from './arena.js';
import { footprintContains } from './colliders.js';
import { climbLimit, slopeAt } from './terrain.js';

/**
 * A walkability grid over a world: which cells a player of a given radius can stand in. Bots
 * find their way around cover with it, and the world builder uses it to find places players
 * cannot reach. Ground steeper than the slope limit counts as closed: players can walk down it
 * but not up, so routes keep off it.
 */
export interface NavGrid {
  cell: number;
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  /** 1 where a player's centre can stand. */
  open: Uint8Array;
}

export interface FloorPoint {
  x: number;
  z: number;
}

/** At most this many cells along a side, so a 200 m world still builds and searches quickly. */
const MAX_CELLS_PER_SIDE = 200;

export function buildNavGrid(arena: Arena, clearance: number, maxSlopeDeg?: number): NavGrid {
  const steep = arena.ground && maxSlopeDeg !== undefined ? climbLimit(maxSlopeDeg) : null;
  const span = Math.max(arena.halfWidth, arena.halfDepth) * 2;
  const cell = Math.max(0.5, span / MAX_CELLS_PER_SIDE);
  const cols = Math.max(1, Math.floor((arena.halfWidth * 2) / cell));
  const rows = Math.max(1, Math.floor((arena.halfDepth * 2) / cell));
  // Centre the cells on the floor.
  const originX = -(cols * cell) / 2;
  const originZ = -(rows * cell) / 2;
  const open = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = originX + (c + 0.5) * cell;
      const z = originZ + (r + 0.5) * cell;
      const onFloor = Math.abs(x) <= arena.halfWidth - clearance && Math.abs(z) <= arena.halfDepth - clearance;
      const blocked =
        onFloor &&
        ((steep !== null && slopeAt(arena.ground, x, z) > steep) || collidersAround(arena, x, z, clearance).some((c2) => footprintContains(c2, x, z, clearance)));
      open[r * cols + c] = onFloor && !blocked ? 1 : 0;
    }
  }
  return { cell, originX, originZ, cols, rows, open };
}

const cellOf = (grid: NavGrid, p: FloorPoint) => ({
  c: Math.min(grid.cols - 1, Math.max(0, Math.floor((p.x - grid.originX) / grid.cell))),
  r: Math.min(grid.rows - 1, Math.max(0, Math.floor((p.z - grid.originZ) / grid.cell))),
});

export const cellCentre = (grid: NavGrid, index: number): FloorPoint => ({
  x: grid.originX + ((index % grid.cols) + 0.5) * grid.cell,
  z: grid.originZ + (Math.floor(index / grid.cols) + 0.5) * grid.cell,
});

/** The open cell nearest to a point (the point's own cell when it is open), or -1 if none. */
export function nearestOpenCell(grid: NavGrid, p: FloorPoint): number {
  const { c, r } = cellOf(grid, p);
  if (grid.open[r * grid.cols + c]) return r * grid.cols + c;
  const maxRing = Math.max(grid.cols, grid.rows);
  for (let ring = 1; ring < maxRing; ring++) {
    let best = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= grid.rows || cc >= grid.cols || !grid.open[rr * grid.cols + cc]) continue;
        const d = dr * dr + dc * dc;
        if (d < bestDist) {
          best = rr * grid.cols + cc;
          bestDist = d;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Breadth-first search over open cells from `start`, moving in 8 directions. Returns each cell's previous cell on its shortest path (-1 for the start, -2 for
 * cells never reached). Stops early once `goal` is reached, if given.
 */
function search(grid: NavGrid, start: number, goal = -1): Int32Array {
  const from = new Int32Array(grid.open.length).fill(-2);
  const queue = new Int32Array(grid.open.length);
  let head = 0;
  let tail = 0;
  from[start] = -1;
  queue[tail++] = start;
  while (head < tail) {
    const current = queue[head++]!;
    if (current === goal) break;
    const c = current % grid.cols;
    const r = Math.floor(current / grid.cols);
    for (const [dc, dr] of NEIGHBOURS) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= grid.cols || rr >= grid.rows) continue;
      const next = rr * grid.cols + cc;
      if (!grid.open[next] || from[next] !== -2) continue;
      // A diagonal step needs one of its side cells open: the cells are smaller than a player, so a
      // diagonal gap with both sides closed is a squeeze between two corners, but one open side is not.
      if (dc !== 0 && dr !== 0 && !grid.open[r * grid.cols + cc] && !grid.open[rr * grid.cols + c]) continue;
      from[next] = current;
      queue[tail++] = next;
    }
  }
  return from;
}

/** Whether a straight walk between two points stays on open cells. */
export function walkable(grid: NavGrid, a: FloorPoint, b: FloorPoint): boolean {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(length / (grid.cell * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { c, r } = cellOf(grid, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    if (!grid.open[r * grid.cols + c]) return false;
  }
  return true;
}

/**
 * A walkable route from `from` to `to` as a few waypoints (corners only), ending at the open
 * cell nearest `to`. Empty when there is no route.
 */
export function findPath(grid: NavGrid, from: FloorPoint, to: FloorPoint): FloorPoint[] {
  const start = nearestOpenCell(grid, from);
  const goal = nearestOpenCell(grid, to);
  if (start < 0 || goal < 0) return [];
  const prev = search(grid, start, goal);
  if (prev[goal] === -2) return [];
  const cells: number[] = [];
  for (let at = goal; at !== -1; at = prev[at]!) cells.push(at);
  cells.reverse();
  // Keep only the corners: skip every waypoint that can be walked past in a straight line.
  const points = cells.map((i) => cellCentre(grid, i));
  const path: FloorPoint[] = [];
  let anchor: FloorPoint = from;
  for (let i = 1; i < points.length; i++) {
    if (!walkable(grid, anchor, points[i]!)) {
      anchor = points[i - 1]!;
      path.push(anchor);
    }
  }
  path.push(points[points.length - 1]!);
  return path;
}

export interface Reachability {
  /** Open cells that cannot be walked to from the first spawn point. */
  unreachableCells: number[];
  /** Indices of spawn points players cannot walk between. */
  cutOffSpawns: number[];
  /** Share of the open floor reachable from the first spawn, 0–1. */
  reachableShare: number;
}

/** Find the parts of a world players cannot walk to from the first spawn point. */
export function reachability(grid: NavGrid, spawns: readonly FloorPoint[]): Reachability {
  const first = spawns[0] ? nearestOpenCell(grid, spawns[0]) : -1;
  if (first < 0) return { unreachableCells: [], cutOffSpawns: spawns.map((_, i) => i), reachableShare: 0 };
  const prev = search(grid, first);
  const unreachableCells: number[] = [];
  let openCount = 0;
  for (let i = 0; i < grid.open.length; i++) {
    if (!grid.open[i]) continue;
    openCount++;
    if (prev[i] === -2) unreachableCells.push(i);
  }
  const cutOffSpawns = spawns.flatMap((p, i) => {
    const cell = nearestOpenCell(grid, p);
    return cell < 0 || prev[cell] === -2 ? [i] : [];
  });
  return { unreachableCells, cutOffSpawns, reachableShare: openCount === 0 ? 0 : 1 - unreachableCells.length / openCount };
}
