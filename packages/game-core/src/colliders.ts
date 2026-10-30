import { clamp } from './math.js';
import { PROPS, type WorldProp } from './world.js';

/** Axis-aligned bounds on the floor plane. */
export interface Bounds2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * A prop as collision sees it: a footprint standing on the ground, `height` tall from `base` (the
 * ground height at its foot; 0 on a flat world). Boxes are oriented (cos/sin of their turn are
 * precomputed); circles have a radius.
 */
export type Collider =
  | { shape: 'box'; x: number; z: number; halfWidth: number; halfDepth: number; cos: number; sin: number; base: number; height: number; bounds: Bounds2 }
  | { shape: 'circle'; x: number; z: number; radius: number; base: number; height: number; bounds: Bounds2 };

export function colliderFromProp(prop: WorldProp, base = 0): Collider {
  if (PROPS[prop.kind].shape === 'circle') {
    const radius = prop.width / 2;
    return {
      shape: 'circle',
      x: prop.x,
      z: prop.z,
      radius,
      base,
      height: prop.height,
      bounds: { minX: prop.x - radius, minZ: prop.z - radius, maxX: prop.x + radius, maxZ: prop.z + radius },
    };
  }
  const angle = (prop.rotation * Math.PI) / 180;
  return boxCollider(prop.x, prop.z, prop.width / 2, prop.depth / 2, prop.height, Math.cos(angle), Math.sin(angle), base);
}

/** An oriented box collider; cos/sin default to no turn, base to the flat floor. */
export function boxCollider(x: number, z: number, halfWidth: number, halfDepth: number, height: number, cos = 1, sin = 0, base = 0): Collider {
  const ex = halfWidth * Math.abs(cos) + halfDepth * Math.abs(sin);
  const ez = halfWidth * Math.abs(sin) + halfDepth * Math.abs(cos);
  return { shape: 'box', x, z, halfWidth, halfDepth, cos, sin, base, height, bounds: { minX: x - ex, minZ: z - ez, maxX: x + ex, maxZ: z + ez } };
}

/**
 * Floor points a prop's foot covers, for finding the ground under it: the centre, plus the corners
 * and edge middles of a box, or eight points round a circle.
 */
export function footprintSamples(prop: WorldProp): { x: number; z: number }[] {
  const points = [{ x: prop.x, z: prop.z }];
  if (PROPS[prop.kind].shape === 'circle') {
    const r = prop.width / 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      points.push({ x: prop.x + Math.cos(a) * r, z: prop.z + Math.sin(a) * r });
    }
    return points;
  }
  const angle = (prop.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const lx of [-1, 0, 1]) {
    for (const lz of [-1, 0, 1]) {
      if (lx === 0 && lz === 0) continue;
      const px = (lx * prop.width) / 2;
      const pz = (lz * prop.depth) / 2;
      points.push({ x: prop.x + px * cos + pz * sin, z: prop.z - px * sin + pz * cos });
    }
  }
  return points;
}

/*
 * A box turned by θ maps its local (lx, lz) to world (x + lx·cos + lz·sin, z − lx·sin + lz·cos),
 * the same as three.js rotation.y, so the client draws exactly what collision uses.
 */
const toLocal = (c: Extract<Collider, { shape: 'box' }>, x: number, z: number) => {
  const dx = x - c.x;
  const dz = z - c.z;
  return { lx: dx * c.cos - dz * c.sin, lz: dx * c.sin + dz * c.cos };
};
const toWorld = (c: Extract<Collider, { shape: 'box' }>, lx: number, lz: number) => ({
  x: c.x + lx * c.cos + lz * c.sin,
  z: c.z - lx * c.sin + lz * c.cos,
});

/** The point of a collider's footprint closest to (x, z), and whether (x, z) is inside it. */
function closestOnFootprint(c: Collider, x: number, z: number): { x: number; z: number; inside: boolean } {
  if (c.shape === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.hypot(dx, dz);
    if (d <= c.radius) return { x, z, inside: true };
    return { x: c.x + (dx / d) * c.radius, z: c.z + (dz / d) * c.radius, inside: false };
  }
  const { lx, lz } = toLocal(c, x, z);
  const cx = clamp(lx, -c.halfWidth, c.halfWidth);
  const cz = clamp(lz, -c.halfDepth, c.halfDepth);
  return { ...toWorld(c, cx, cz), inside: cx === lx && cz === lz };
}

/** Whether a floor point lies inside a collider's footprint, grown by `margin`. */
export function footprintContains(c: Collider, x: number, z: number, margin = 0): boolean {
  const closest = closestOnFootprint(c, x, z);
  return closest.inside || Math.hypot(x - closest.x, z - closest.z) < margin;
}

/**
 * Push a circle (a player's footprint) out of a collider. Returns the new centre, or null when
 * they do not overlap. A centre inside the footprint leaves through the nearest edge.
 */
export function pushCircleOut(c: Collider, x: number, z: number, r: number): { x: number; z: number } | null {
  if (c.shape === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    const reach = c.radius + r;
    const distSq = dx * dx + dz * dz;
    if (distSq >= reach * reach) return null;
    const d = Math.sqrt(distSq);
    if (d < 1e-9) return { x: c.x + reach, z: c.z };
    return { x: c.x + (dx / d) * reach, z: c.z + (dz / d) * reach };
  }
  const { lx, lz } = toLocal(c, x, z);
  const cx = clamp(lx, -c.halfWidth, c.halfWidth);
  const cz = clamp(lz, -c.halfDepth, c.halfDepth);
  const ox = lx - cx;
  const oz = lz - cz;
  const distSq = ox * ox + oz * oz;
  if (distSq >= r * r) return null;
  if (distSq > 1e-12) {
    const d = Math.sqrt(distSq);
    return toWorld(c, cx + (ox / d) * r, cz + (oz / d) * r);
  }
  // Centre inside the box: leave through the nearest face.
  const exits = [
    { d: lx + c.halfWidth, lx: -c.halfWidth - r, lz },
    { d: c.halfWidth - lx, lx: c.halfWidth + r, lz },
    { d: lz + c.halfDepth, lx, lz: -c.halfDepth - r },
    { d: c.halfDepth - lz, lx, lz: c.halfDepth + r },
  ].sort((p, q) => p.d - q.d);
  const exit = exits[0]!;
  return toWorld(c, exit.lx, exit.lz);
}

/** Whether a sphere (a projectile) touches a collider: footprint and height together. */
export function sphereHitsCollider(c: Collider, x: number, y: number, z: number, r: number): boolean {
  const dy = y - clamp(y, c.base, c.base + c.height);
  if (Math.abs(dy) > r) return false;
  const closest = closestOnFootprint(c, x, z);
  const dx = closest.inside ? 0 : x - closest.x;
  const dz = closest.inside ? 0 : z - closest.z;
  return dx * dx + dz * dz + dy * dy <= r * r;
}
