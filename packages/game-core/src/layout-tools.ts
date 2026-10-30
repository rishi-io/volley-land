import { type FloorRegion, PROPS, type PropKind, type SurfaceId, type WorldProp, newProp } from './world.js';

/** Symmetry for fair worlds: mirror left/right, front/back, or both (four-way). */
export type Symmetry = 'none' | 'mirror-x' | 'mirror-z' | 'quad';

type Placed = { x: number; z: number; rotation: number };

/** An angle in [0, 360), tidied to 4 decimals so repeated turns do not drift. */
export const normalizeDegrees = (deg: number): number => {
  const d = ((deg % 360) + 360) % 360;
  return Math.abs(d - 360) < 1e-9 ? 0 : Number(d.toFixed(4));
};

/** The mirror image of an item across the x = 0 line (flip x) or z = 0 line (flip z). A mirror reverses the turn. */
export function mirrorItem<T extends Placed>(item: T, axis: 'x' | 'z'): T {
  return { ...item, x: axis === 'x' ? -item.x : item.x, z: axis === 'z' ? -item.z : item.z, rotation: normalizeDegrees(-item.rotation) };
}

/** Copies of `items` for a symmetry. An item on a mirror line is not copied onto itself. */
export function applySymmetry<T extends Placed>(items: readonly T[], symmetry: Symmetry): T[] {
  const out: T[] = [];
  const same = (a: T, b: T) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;
  for (const item of items) {
    const copies = [item];
    if (symmetry === 'mirror-x' || symmetry === 'quad') copies.push(mirrorItem(item, 'x'));
    if (symmetry === 'mirror-z') copies.push(mirrorItem(item, 'z'));
    if (symmetry === 'quad') copies.push(mirrorItem(item, 'z'), mirrorItem(mirrorItem(item, 'x'), 'z'));
    for (const copy of copies) if (!copies.slice(0, copies.indexOf(copy)).some((o) => same(o, copy))) out.push(copy);
  }
  return out;
}

export interface PropOptions {
  rotation?: number;
  width?: number;
  depth?: number;
  height?: number;
  /** Multiplies the catalogue size (before any explicit width, depth or height). */
  scale?: number;
}

/** A prop of a kind at its catalogue size, adjusted by options. */
export function prop(kind: PropKind, x: number, z: number, options: PropOptions = {}): WorldProp {
  const base = newProp(kind, x, z, normalizeDegrees(options.rotation ?? 0));
  const s = options.scale ?? 1;
  const width = round(options.width ?? base.width * s);
  return {
    ...base,
    width,
    depth: PROPS[kind].shape === 'circle' ? width : round(options.depth ?? base.depth * s),
    height: round(options.height ?? base.height * s),
  };
}

const round = (v: number) => Math.round(v * 100) / 100;

export function rect(surface: SurfaceId, x: number, z: number, width: number, depth: number, rotation = 0): FloorRegion {
  return { surface, shape: 'rect', x, z, width, depth, rotation: normalizeDegrees(rotation) };
}

export function ellipse(surface: SurfaceId, x: number, z: number, width: number, depth: number, rotation = 0): FloorRegion {
  return { surface, shape: 'ellipse', x, z, width, depth, rotation: normalizeDegrees(rotation) };
}

/**
 * `count` props evenly round a circle, each turned to lie along it (a ring of walls or hedges).
 * `startDeg` is where the first one sits, measured from +x towards +z.
 */
export function ring(kind: PropKind, count: number, radius: number, options: PropOptions & { startDeg?: number; skip?: (i: number) => boolean } = {}): WorldProp[] {
  const out: WorldProp[] = [];
  for (let i = 0; i < count; i++) {
    if (options.skip?.(i)) continue;
    const deg = (options.startDeg ?? 0) + (360 * i) / count;
    const a = (deg * Math.PI) / 180;
    // Tangent to the circle: a box's local x points along the ring.
    out.push(prop(kind, round(Math.cos(a) * radius), round(Math.sin(a) * radius), { ...options, rotation: (options.rotation ?? 0) - deg + 90 }));
  }
  return out;
}
