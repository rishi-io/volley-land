import { type FloorRegion, type HeightField, type WorldLayout, groundShape, heightAt } from '@volleyland/game-core';
import { BufferAttribute, BufferGeometry, Float32BufferAttribute, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Ground meshes for worlds with terrain. The floor mesh uses the height field's own samples and
 * splits each cell along the same diagonal as game-core's heightAt, so players and props stand
 * exactly on the ground that is drawn. Round the floor, a band of land carries the ground on and
 * eases it down to level, where the flat outside ground (or the sea) takes over.
 */

/** Where the ground sits outside the floor: the same shape, eased to 0 across the band. */
export function outsideHeight(layout: WorldLayout, band: number): (x: number, z: number) => number {
  const shape = groundShape(layout);
  return (x, z) => {
    const dx = Math.max(0, Math.abs(x) - layout.halfWidth);
    const dz = Math.max(0, Math.abs(z) - layout.halfDepth);
    const d = Math.hypot(dx, dz);
    if (band <= 0 || d >= band) return 0;
    const t = d / band;
    return shape(x, z) * (1 - t * t * (3 - 2 * t));
  };
}

/** The floor's ground: one vertex per height sample, two triangles per cell. */
export function floorGeometry(field: HeightField): BufferGeometry {
  return gridGeometry(field, 0, 0, () => true, (c, r) => field.heights[r * (field.cols + 1) + c]!);
}

/**
 * The band of land round the floor, out to `band` metres (rounded up to whole cells), on the
 * floor's grid so its inner edge meets the floor's edge vertex for vertex. Null without a band.
 */
export function bandGeometry(layout: WorldLayout, field: HeightField, band: number): { geometry: BufferGeometry; halfWidth: number; halfDepth: number } | null {
  if (band <= 0) return null;
  const nx = Math.ceil(band / field.cellX);
  const nz = Math.ceil(band / field.cellZ);
  const outside = outsideHeight(layout, band);
  const inFloor = (c: number, r: number) => c >= nx && c < nx + field.cols && r >= nz && r < nz + field.rows;
  const geometry = gridGeometry(
    field,
    nx,
    nz,
    (c, r) => !inFloor(c, r),
    (c, r) => {
      // Floor-edge vertices take the field's samples exactly; the rest the eased shape.
      const fc = c - nx;
      const fr = r - nz;
      if (fc >= 0 && fc <= field.cols && fr >= 0 && fr <= field.rows) return field.heights[fr * (field.cols + 1) + fc]!;
      return outside(field.originX + fc * field.cellX, field.originZ + fr * field.cellZ);
    },
  );
  return { geometry, halfWidth: -field.originX + nx * field.cellX, halfDepth: -field.originZ + nz * field.cellZ };
}

/**
 * A grid of cells over the floor's lattice, `padX`/`padZ` cells wider on every side, keeping the
 * cells `keep` accepts. Cell (c, r) has corners a = (c, r), b = (c+1, r), c' = (c, r+1),
 * d = (c+1, r+1); its triangles are (a, c', b) and (b, c', d), facing up, split along b–c' like heightAt.
 */
function gridGeometry(field: HeightField, padX: number, padZ: number, keep: (c: number, r: number) => boolean, height: (c: number, r: number) => number): BufferGeometry {
  const cols = field.cols + padX * 2;
  const rows = field.rows + padZ * 2;
  const stride = cols + 1;
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const i = (r * stride + c) * 3;
      positions[i] = field.originX + (c - padX) * field.cellX;
      positions[i + 1] = height(c, r);
      positions[i + 2] = field.originZ + (r - padZ) * field.cellZ;
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!keep(c, r)) continue;
      const a = r * stride + c;
      const b = a + 1;
      const cc = a + stride;
      const d = cc + 1;
      indices.push(a, cc, b, b, cc, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(positions.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(indices), 1) : new BufferAttribute(new Uint16Array(indices), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Sides hanging from the floor's edges down to `bottom`, for a world floating in space (draw both faces). */
export function skirtGeometry(field: HeightField, bottom: number): BufferGeometry {
  const positions: number[] = [];
  const edge = (points: { x: number; z: number; y: number }[]) => {
    for (let i = 0; i < points.length - 1; i++) {
      const p = points[i]!;
      const q = points[i + 1]!;
      positions.push(p.x, p.y, p.z, p.x, bottom, p.z, q.x, q.y, q.z, q.x, q.y, q.z, p.x, bottom, p.z, q.x, bottom, q.z);
    }
  };
  const at = (c: number, r: number) => ({ x: field.originX + c * field.cellX, z: field.originZ + r * field.cellZ, y: field.heights[r * (field.cols + 1) + c]! });
  const range = (n: number) => Array.from({ length: n + 1 }, (_, i) => i);
  edge(range(field.cols).map((c) => at(c, 0)));
  edge(range(field.cols).map((c) => at(c, field.rows)));
  edge(range(field.rows).map((r) => at(0, r)));
  edge(range(field.rows).map((r) => at(field.cols, r)));
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/** A flat frame: the area between an inner and an outer rectangle, at height `y`. */
export function frameGeometry(inner: { halfWidth: number; halfDepth: number }, outer: { halfWidth: number; halfDepth: number }, y: number): BufferGeometry {
  const strip = (cx: number, cz: number, w: number, d: number) => {
    const g = new PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(cx, y, cz);
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const { halfWidth: iw, halfDepth: id } = inner;
  const { halfWidth: ow, halfDepth: od } = outer;
  return mergeGeometries([
    strip(0, (od + id) / 2, ow * 2, od - id),
    strip(0, -(od + id) / 2, ow * 2, od - id),
    strip((ow + iw) / 2, 0, ow - iw, id * 2),
    strip(-(ow + iw) / 2, 0, ow - iw, id * 2),
  ])!;
}

/**
 * A painted region draped over the ground: a fine grid in the region's shape, each vertex lifted
 * to the ground under it (plus `lift`, so it sits on top). Its triangles are not the ground's, so
 * the material also pulls it forward (polygon offset) to stop it flickering.
 */
export function drapedRegion(region: FloorRegion, field: HeightField, lift: number): BufferGeometry {
  const step = Math.max(field.cellX, field.cellZ);
  let g: BufferGeometry;
  if (region.shape === 'rect') {
    const sx = Math.min(200, Math.max(1, Math.ceil(region.width / step)));
    const sz = Math.min(200, Math.max(1, Math.ceil(region.depth / step)));
    g = new PlaneGeometry(region.width, region.depth, sx, sz);
    g.rotateX(-Math.PI / 2);
  } else {
    g = diskGeometry(Math.min(100, Math.max(2, Math.ceil(Math.max(region.width, region.depth) / 2 / step))), 48);
    g.scale(region.width, 1, region.depth);
  }
  g.rotateY((region.rotation * Math.PI) / 180);
  g.translate(region.x, 0, region.z);
  g.deleteAttribute('uv');
  const position = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < position.count; i++) position.setY(i, heightAt(field, position.getX(i), position.getZ(i)) + lift);
  g.computeVertexNormals();
  return g.index ? g.toNonIndexed() : g;
}

/** A flat disk of diameter 1 on the floor plane (x and z in [-0.5, 0.5]), in rings, so it can follow the ground. */
function diskGeometry(rings: number, segments: number): BufferGeometry {
  const positions: number[] = [0, 0, 0];
  for (let r = 1; r <= rings; r++) {
    const radius = (0.5 * r) / rings;
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    }
  }
  const at = (r: number, s: number) => (r === 0 ? 0 : 1 + (r - 1) * segments + (s % segments));
  const indices: number[] = [];
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      if (r === 0) {
        indices.push(0, at(1, s + 1), at(1, s));
      } else {
        indices.push(at(r, s), at(r, s + 1), at(r + 1, s), at(r, s + 1), at(r + 1, s + 1), at(r + 1, s));
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}
