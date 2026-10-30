import { PROPS, type PropKind } from '@volleyland/game-core';
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Low-poly, toon-shaded prop models built from primitives: no model files to download. Each is
 * modelled in metres at its catalogue size, then normalised to a unit footprint (x and z in
 * [-0.5, 0.5], y in [0, 1]); an instance matrix scales it to the placed prop's size, so a world
 * with 300 trees draws them in one call. A model's visible height always matches the prop's
 * collision height, so what looks like cover is cover.
 */

export interface Model {
  /** Toon-shaded parts, coloured per vertex. */
  solid: BufferGeometry | null;
  /** A box textured with the theme's facing (blocks and walls). */
  faced: BufferGeometry | null;
  /** Unlit parts that glow (bulbs, screens, light strips). */
  glow: BufferGeometry | null;
  /** Per-instance tints for props that come in several colours (white means "as modelled"). */
  tints: string[];
}

interface Place {
  x?: number;
  y?: number;
  z?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

/** Paint a primitive one colour, then turn, scale and move it into place. */
export function part(geometry: BufferGeometry, color: string, p: Place = {}): BufferGeometry {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  g.scale(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
  if (p.rx) g.rotateX(p.rx);
  if (p.rz) g.rotateZ(p.rz);
  if (p.ry) g.rotateY(p.ry);
  g.translate(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  const c = new Color(color);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g = g.index ? g.toNonIndexed() : g;
  return g;
}

/** A box resting on y = `y`, its centre at (x, z). */
export const box = (w: number, h: number, d: number, color: string, p: Place = {}) => part(new BoxGeometry(w, h, d), color, { ...p, y: (p.y ?? 0) + h / 2 });
/** An upright cylinder resting on y = `y`. */
export const cyl = (r: number, h: number, color: string, p: Place = {}, segments = 12, rTop = r) =>
  part(new CylinderGeometry(rTop, r, h, segments), color, { ...p, y: (p.y ?? 0) + h / 2 });
export const ball = (r: number, color: string, p: Place = {}, detail = 1) => part(new IcosahedronGeometry(r, detail), color, p);
export const cone = (r: number, h: number, color: string, p: Place = {}, segments = 10) => part(new ConeGeometry(r, h, segments), color, { ...p, y: (p.y ?? 0) + h / 2 });

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A wheel (or any disc) facing along z, its centre at (x, y, z). */
const wheel = (r: number, width: number, color: string, p: Place = {}) => part(new CylinderGeometry(r, r, width, 14), color, { rx: Math.PI / 2, ...p });
/** A half disc standing in the x-y plane, flat side down: the top of an arch. */
const arch = (r: number, thick: number, color: string, p: Place = {}) =>
  part(new CylinderGeometry(r, r, thick, 12, 1, false, Math.PI / 2, Math.PI), color, { rx: Math.PI / 2, ...p });
/** `count` copies of a part spaced round a circle, each turned to face outwards. */
function around(count: number, radius: number, make: (p: Place) => BufferGeometry, p: Place = {}, offset = 0): BufferGeometry[] {
  return Array.from({ length: count }, (_, i) => {
    const a = offset + (i / count) * Math.PI * 2;
    return make({ ...p, x: (p.x ?? 0) + Math.sin(a) * radius, z: (p.z ?? 0) + Math.cos(a) * radius, ry: a });
  });
}

const STONE = '#a8a39a';
const STONE_DARK = '#8f8a81';
const SLOT = '#2a2522';
const BANNER = '#b5332e';
const GLASS = '#1e2a36';
const TYRE = '#1f1f24';
const HULL = '#56606e';
const HULL_DARK = '#3d4654';
const CYAN = '#4cc9f0';

export const BOOK_COLORS = ['#c0392b', '#2e86ab', '#f2b134', '#3c8d5a', '#7b4f9d', '#e07a5f', '#264653', '#e9c46a'];
export const FLOWER_COLORS = ['#ff6b8b', '#ffd166', '#ffffff', '#c77dff'];

interface Recipe {
  solid?: () => BufferGeometry[];
  faced?: boolean;
  glow?: () => BufferGeometry[];
  tints?: string[];
}

const RECIPES: Record<PropKind, Recipe> = {
  block: { faced: true },
  wall: { faced: true, solid: () => [box(6.08, 0.12, 0.68, '#d8d2c4', { y: 1.88 })] },
  crate: {
    tints: ['#ffffff', '#f2e3cf', '#e5d2b8'],
    solid: () => {
      const s = 1.2;
      const t = 0.12;
      const frame = '#7a5230';
      const parts = [box(s - 0.04, s - 0.04, s - 0.04, '#c08a52', { y: 0.02 })];
      for (const x of [-1, 1]) for (const z of [-1, 1]) parts.push(box(t, s, t, frame, { x: (x * (s - t)) / 2, z: (z * (s - t)) / 2 }));
      for (const y of [0, s - t]) {
        parts.push(box(s, t, t, frame, { y, z: (s - t) / 2 }), box(s, t, t, frame, { y, z: -(s - t) / 2 }));
        parts.push(box(t, t, s, frame, { y, x: (s - t) / 2 }), box(t, t, s, frame, { y, x: -(s - t) / 2 }));
      }
      parts.push(part(new BoxGeometry(t * 0.8, s * 1.25, 0.03), frame, { y: s / 2, z: s / 2 - 0.005, rz: Math.PI / 4 }));
      parts.push(part(new BoxGeometry(t * 0.8, s * 1.25, 0.03), frame, { y: s / 2, z: -s / 2 + 0.005, rz: -Math.PI / 4 }));
      return parts;
    },
  },
  barrel: {
    tints: ['#ffffff', '#d9e8f5', '#f5dcc8'],
    solid: () => [
      cyl(0.46, 1.2, '#9a6a44', {}, 14),
      cyl(0.5, 0.1, '#3d3d44', { y: 0.2 }, 14),
      cyl(0.5, 0.1, '#3d3d44', { y: 0.9 }, 14),
      cyl(0.4, 0.02, '#6b4a2f', { y: 1.19 }, 14),
    ],
  },
  rock: {
    tints: ['#ffffff', '#e8e4dc', '#d8dde4'],
    solid: () => [
      part(new DodecahedronGeometry(1, 0), '#8d8f94', { y: 0.62, sx: 0.95, sy: 0.66, sz: 0.85, ry: 0.4 }),
      part(new DodecahedronGeometry(0.55, 0), '#7c7f85', { x: 0.5, y: 0.32, z: 0.32, ry: 1.1 }),
      part(new DodecahedronGeometry(0.4, 0), '#999ca1', { x: -0.55, y: 0.25, z: -0.35 }),
    ],
  },
  tree: {
    tints: ['#ffffff', '#e9f5c9', '#ffe7c2'],
    solid: () => [
      cyl(0.24, 1.8, '#7a5230', {}, 8, 0.17),
      ball(1.2, '#4f9a3c', { y: 2.5 }),
      ball(0.85, '#5fae46', { x: 0.5, y: 3.1, z: 0.2 }),
      ball(0.8, '#468a35', { x: -0.55, y: 2.85, z: -0.3 }),
    ],
  },
  pine: {
    solid: () => [
      cyl(0.16, 0.9, '#6b4a2f', {}, 8),
      cone(1.2, 1.8, '#2f6b4a', { y: 0.6 }),
      cone(0.95, 1.6, '#357a52', { y: 1.7 }),
      cone(0.65, 1.4, '#3c875b', { y: 2.75 }),
      cone(0.32, 0.5, '#f3f8fc', { y: 3.98 }),
    ],
  },
  palm: {
    solid: () => {
      const parts: BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        parts.push(cyl(0.2 - i * 0.015, 0.68, i % 2 ? '#8c6440' : '#a67c52', { x: Math.pow(i / 6, 2) * 0.5, y: i * 0.66 }, 8));
      }
      const top = { x: 0.5, y: 4.0 };
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push(
          part(new SphereGeometry(1, 8, 4), i % 2 ? '#3f9b4b' : '#4caf50', {
            sx: 1.25,
            sy: 0.1,
            sz: 0.3,
            rz: -0.35,
            ry: a,
            x: top.x + Math.cos(a) * 1.0,
            y: top.y + 0.1,
            z: -Math.sin(a) * 1.0,
          }),
        );
      }
      for (let i = 0; i < 3; i++) parts.push(ball(0.15, '#6b4a2f', { x: top.x + Math.cos(i * 2.1) * 0.22, y: top.y - 0.1, z: Math.sin(i * 2.1) * 0.22 }, 0));
      return parts;
    },
  },
  hedge: {
    solid: () => {
      const r = rng(5);
      const parts = [box(3, 0.78, 1, '#3f7d3a'), box(2.9, 0.12, 0.9, '#4b9145', { y: 0.78 })];
      for (let i = 0; i < 14; i++) {
        parts.push(ball(0.06, FLOWER_COLORS[i % FLOWER_COLORS.length]!, { x: (r() - 0.5) * 2.8, y: 0.3 + r() * 0.5, z: (r() < 0.5 ? -1 : 1) * 0.5 }, 0));
      }
      return parts;
    },
  },
  planter: {
    solid: () => {
      const r = rng(9);
      const parts = [box(2, 0.48, 1, '#b5654a'), box(2.06, 0.08, 1.06, '#9a523b', { y: 0.44 }), box(1.84, 0.05, 0.84, '#4a3424', { y: 0.47 })];
      for (let i = 0; i < 5; i++) parts.push(ball(0.2, '#4f9a3c', { x: -0.75 + i * 0.37, y: 0.53, z: (r() - 0.5) * 0.3 }, 0));
      for (let i = 0; i < 8; i++) parts.push(ball(0.06, FLOWER_COLORS[i % FLOWER_COLORS.length]!, { x: (r() - 0.5) * 1.7, y: 0.62 + r() * 0.06, z: (r() - 0.5) * 0.6 }, 0));
      return parts;
    },
  },
  bench: {
    solid: () => {
      const wood = '#b07d48';
      const iron = '#3d4450';
      const parts = [0, 1, 2].map((i) => box(2, 0.05, 0.13, wood, { y: 0.42, z: -0.1 + i * 0.16 }));
      parts.push(box(2, 0.12, 0.05, wood, { y: 0.55, z: -0.3 }), box(2, 0.12, 0.05, wood, { y: 0.68, z: -0.3 }));
      for (const x of [-0.8, 0.8]) {
        parts.push(box(0.06, 0.42, 0.5, iron, { x, z: 0.02 }), box(0.06, 0.8, 0.06, iron, { x, z: -0.3 }));
      }
      return parts;
    },
  },
  pillar: {
    solid: () => [box(1.2, 0.3, 1.2, '#d1ccbf'), cyl(0.45, 2.4, '#ece8de', { y: 0.3 }, 16), box(1.15, 0.3, 1.15, '#d1ccbf', { y: 2.7 })],
  },
  lamp: {
    solid: () => [cyl(0.2, 0.3, '#2f3640', {}, 10), cyl(0.07, 2.95, '#2f3640', { y: 0.3 }, 8), cone(0.24, 0.25, '#2f3640', { y: 3.25 }, 8)],
    glow: () => [ball(0.15, '#ffe8a3', { y: 3.12 }, 1)],
  },
  fountain: {
    solid: () => [
      cyl(2, 0.55, '#cfc8b8', {}, 24),
      cyl(1.78, 0.04, '#58b4e6', { y: 0.52 }, 24),
      cyl(0.32, 0.72, '#cfc8b8', { y: 0.05 }, 12),
      cyl(0.62, 0.1, '#cfc8b8', { y: 0.72 }, 14),
      cyl(0.5, 0.03, '#7fcaf0', { y: 0.8 }, 14),
      ball(0.1, '#d6f0ff', { y: 0.86 }, 0),
    ],
  },
  pond: {
    solid: () => {
      const parts = [cyl(2.3, 0.05, '#3f9fd8', { y: 0.02 }, 28)];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        parts.push(part(new DodecahedronGeometry(0.32, 0), i % 2 ? '#9a9a9a' : '#b0aea8', { x: Math.cos(a) * 2.32, y: 0.15, z: Math.sin(a) * 2.32, sy: 0.48, ry: i }));
      }
      for (const [x, z] of [
        [0.7, 0.4],
        [-0.9, -0.6],
        [0.2, -1.1],
      ]) {
        parts.push(cyl(0.3, 0.02, '#5aa850', { x, z, y: 0.07 }, 10));
      }
      return parts;
    },
  },
  bookshelf: {
    solid: () => {
      const r = rng(17);
      const wood = '#6b4a32';
      const parts = [box(3, 2.4, 0.08, '#5a3d29'), box(0.08, 2.4, 0.8, wood, { x: -1.46 }), box(0.08, 2.4, 0.8, wood, { x: 1.46 }), box(3, 0.08, 0.8, wood, { y: 2.32 })];
      const shelfYs = [0.05, 0.62, 1.19, 1.76];
      for (const y of shelfYs) {
        parts.push(box(2.9, 0.06, 0.78, wood, { y }));
        for (const side of [-1, 1]) {
          let x = -1.38;
          while (x < 1.34) {
            const w = 0.08 + r() * 0.08;
            const h = 0.32 + r() * 0.16;
            if (r() < 0.08) {
              x += 0.12;
              continue;
            }
            parts.push(box(w, h, 0.28, BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]!, { x: x + w / 2, y: y + 0.06, z: side * 0.2 }));
            x += w + 0.01;
          }
        }
      }
      return parts;
    },
  },
  desk: {
    solid: () => {
      const wood = '#8a5a3a';
      const parts = [box(1.8, 0.06, 1, wood, { y: 0.66 })];
      for (const x of [-0.82, 0.82]) for (const z of [-0.42, 0.42]) parts.push(box(0.07, 0.66, 0.07, '#6b4430', { x, z }));
      parts.push(box(0.36, 0.05, 0.26, '#2e86ab', { x: -0.5, y: 0.72, ry: 0.2 }), box(0.32, 0.05, 0.24, '#c0392b', { x: -0.5, y: 0.77, ry: 0.35 }));
      parts.push(box(0.5, 0.02, 0.34, '#f4efe1', { x: 0.35, y: 0.72, ry: -0.15 }));
      return parts;
    },
  },
  snowman: {
    solid: () => [
      ball(0.64, '#f7fbff', { y: 0.6 }, 2),
      ball(0.44, '#f7fbff', { y: 1.28 }, 2),
      ball(0.28, '#f7fbff', { y: 1.6 }, 2),
      part(new ConeGeometry(0.06, 0.28, 8), '#f08a24', { rx: Math.PI / 2, y: 1.6, z: 0.38 }),
      ball(0.04, '#1f2328', { x: -0.1, y: 1.68, z: 0.24 }, 0),
      ball(0.04, '#1f2328', { x: 0.1, y: 1.68, z: 0.24 }, 0),
      part(new TorusGeometry(0.3, 0.07, 6, 16), '#d62839', { rx: Math.PI / 2, y: 1.42 }),
      part(new CylinderGeometry(0.03, 0.03, 0.8, 5), '#6b4a2f', { rz: 1.1, x: 0.65, y: 1.4 }),
      part(new CylinderGeometry(0.03, 0.03, 0.8, 5), '#6b4a2f', { rz: -1.1, x: -0.65, y: 1.4 }),
    ],
  },
  cactus: {
    solid: () => [
      cyl(0.25, 1.85, '#4c9a52', {}, 10),
      ball(0.25, '#4c9a52', { y: 1.85 }, 1),
      cyl(0.13, 0.5, '#4c9a52', { x: 0.36, y: 0.9 }, 8),
      part(new CylinderGeometry(0.13, 0.13, 0.42, 8), '#4c9a52', { rz: Math.PI / 2, x: 0.2, y: 0.9 }),
      cyl(0.12, 0.4, '#4c9a52', { x: -0.33, y: 1.2 }, 8),
      part(new CylinderGeometry(0.12, 0.12, 0.36, 8), '#4c9a52', { rz: Math.PI / 2, x: -0.18, y: 1.2 }),
      ball(0.09, '#ff6b8b', { y: 2.1 }, 0),
    ],
  },
  sandcastle: {
    solid: () => {
      const sand = '#e0c48a';
      const parts = [cyl(0.9, 0.32, '#d8ba7c', {}, 16), box(0.7, 0.55, 0.7, sand, { y: 0.32 })];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        parts.push(cyl(0.2, 0.62, sand, { x: Math.cos(a) * 0.55, z: Math.sin(a) * 0.55, y: 0.3 }, 10), cone(0.22, 0.18, '#cfb075', { x: Math.cos(a) * 0.55, z: Math.sin(a) * 0.55, y: 0.92 }, 10));
      }
      parts.push(cyl(0.015, 0.25, '#6b4a2f', { y: 0.87 }, 4), box(0.16, 0.09, 0.01, '#e63946', { x: 0.08, y: 1.0 }));
      return parts;
    },
  },
  boat: {
    solid: () => {
      const hull = '#8a5a3a';
      const parts = [
        box(3.2, 0.7, 1.7, hull, { x: -0.4 }),
        // The bow: a four-sided cone laid along +x, flattened to the hull's height.
        part(new ConeGeometry(1.2, 1.35, 4, 1).rotateY(Math.PI / 4), hull, { sx: 0.41, rz: -Math.PI / 2, x: 1.55, y: 0.35 }),
        box(3.3, 0.12, 1.8, '#b07d48', { x: -0.4, y: 0.62 }),
        box(0.25, 0.08, 1.6, '#c99a64', { x: -1.2, y: 0.5 }),
        box(0.25, 0.08, 1.6, '#c99a64', { x: 0.3, y: 0.5 }),
        box(3.1, 0.06, 1.5, '#5e3f24', { x: -0.4, y: 0.2 }),
      ];
      parts.push(part(new CylinderGeometry(0.07, 0.08, 1.0, 6), '#6b4a2f', { x: -0.4, y: 0.95, rz: 0.5 }));
      return parts;
    },
  },
  tire: {
    tints: ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#e9c46a'],
    solid: () => [part(new TorusGeometry(0.42, 0.18, 8, 18), '#ffffff', { rx: Math.PI / 2, y: 0.2, sy: 1, sz: 1.25 })],
  },
  pod: {
    solid: () => [
      cyl(1.1, 0.18, '#3d4654', {}, 20),
      cyl(1.0, 0.85, '#c9d3df', { y: 0.18 }, 20),
      part(new SphereGeometry(1.0, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#dbe3ec', { y: 1.02, sy: 0.55 }),
      box(0.5, 0.3, 0.1, '#1d2230', { y: 0.95, z: 0.98 }),
    ],
    glow: () => [part(new TorusGeometry(1.02, 0.04, 6, 32), '#4cc9f0', { rx: Math.PI / 2, y: 0.6 })],
  },
  console: {
    solid: () => [box(2, 0.62, 1, '#56606e'), part(new BoxGeometry(2, 0.12, 0.9), '#2c3340', { y: 0.72, rx: -0.35, z: 0.02 })],
    glow: () => [
      part(new BoxGeometry(1.4, 0.02, 0.5), '#4cc9f0', { y: 0.8, rx: -0.35, z: -0.02 }),
      ball(0.04, '#ef476f', { x: 0.85, y: 0.66, z: 0.42 }, 0),
      ball(0.04, '#06d6a0', { x: 0.72, y: 0.66, z: 0.42 }, 0),
      ball(0.04, '#ffd166', { x: -0.85, y: 0.66, z: 0.42 }, 0),
    ],
  },

  /* ---------- the past ---------- */
  tower: {
    solid: () => [
      cyl(1.5, 0.3, '#7d786f', {}, 14),
      cyl(1.35, 5.0, STONE, { y: 0.3 }, 14, 1.3),
      ...[1.5, 2.8, 4.1].map((y) => cyl(1.36 - y * 0.01, 0.06, STONE_DARK, { y }, 14)),
      cyl(1.45, 0.15, STONE_DARK, { y: 5.15 }, 14),
      cyl(1.5, 0.3, STONE, { y: 5.3 }, 16),
      ...around(10, 1.28, (p) => box(0.42, 0.4, 0.42, STONE, { ...p, y: 5.6 })),
      ...around(4, 1.33, (p) => box(0.14, 0.7, 0.08, SLOT, { ...p, y: 2.2 }), {}, Math.PI / 4),
      ...around(3, 1.31, (p) => box(0.14, 0.6, 0.08, SLOT, { ...p, y: 4.2 }), {}, Math.PI / 3),
      box(0.8, 1.4, 0.1, '#5a3d29', { y: 0.3, z: 1.33 }),
      box(0.6, 1.2, 0.04, BANNER, { y: 3.4, z: 1.33 }),
      box(0.22, 0.22, 0.05, '#f2c14e', { y: 4.0, z: 1.34, rz: Math.PI / 4 }),
    ],
  },
  rampart: {
    solid: () => {
      const parts = [box(6, 0.35, 1.2, '#7d786f'), box(6, 2.2, 1.12, STONE, { y: 0.35 }), box(6, 0.06, 1.16, STONE_DARK, { y: 1.3 }), box(6, 0.06, 1.16, STONE_DARK, { y: 2.0 })];
      for (let i = 0; i < 7; i++) parts.push(box(0.55, 0.45, 1.12, STONE, { x: -3 + ((i + 0.5) * 6) / 7, y: 2.55 }));
      for (const z of [-0.57, 0.57]) for (const x of [-1.5, 1.5]) parts.push(box(0.12, 0.6, 0.04, SLOT, { x, y: 1.5, z }));
      return parts;
    },
  },
  gatehouse: {
    solid: () => {
      const parts = [box(3.0, 3.4, 2.0, STONE)];
      for (const x of [-1.9, 1.9]) {
        parts.push(cyl(1.0, 3.7, STONE, { x }, 14), cyl(1.1, 0.4, STONE_DARK, { x, y: 3.7 }, 14));
        parts.push(...around(8, 0.92, (p) => box(0.36, 0.4, 0.36, STONE, { ...p, y: 4.1 }), { x }));
        parts.push(...around(2, 0.98, (p) => box(0.12, 0.6, 0.08, SLOT, { ...p, y: 2.6 }), { x }, Math.PI / 2));
      }
      for (let i = 0; i < 4; i++) for (const z of [-0.85, 0.85]) parts.push(box(0.4, 0.4, 0.3, STONE, { x: -0.9 + i * 0.6, y: 3.4, z }));
      for (const side of [-1, 1]) {
        const z = side * 1.0;
        parts.push(box(1.6, 2.2, 0.06, SLOT, { z }), arch(0.8, 0.06, SLOT, { y: 2.2, z }));
        for (let x = -0.6; x <= 0.61; x += 0.3) parts.push(box(0.07, 2.12 + Math.sqrt(0.64 - x * x), 0.05, '#4a4e57', { x, z: side * 1.04 }));
        for (const y of [0.4, 0.9, 1.4, 1.9, 2.4]) parts.push(box(y > 2.2 ? 1.4 : 1.55, 0.07, 0.05, '#4a4e57', { y, z: side * 1.06 }));
        for (const x of [-1.9, 1.9]) parts.push(box(0.5, 1.0, 0.04, BANNER, { x, y: 1.6, z }));
      }
      return parts;
    },
  },
  well: {
    solid: () => [
      cyl(0.85, 0.8, STONE, {}, 14),
      cyl(0.66, 0.02, '#3f6fa0', { y: 0.74 }, 14),
      part(new TorusGeometry(0.76, 0.1, 6, 16), STONE_DARK, { rx: Math.PI / 2, y: 0.8 }),
      box(0.12, 1.5, 0.12, '#6b4a2f', { x: -0.7, y: 0.8 }),
      box(0.12, 1.5, 0.12, '#6b4a2f', { x: 0.7, y: 0.8 }),
      part(new CylinderGeometry(0.06, 0.06, 1.4, 6), '#7a5230', { rz: Math.PI / 2, y: 1.9 }),
      cyl(0.015, 0.4, '#d8c79a', { y: 1.5 }, 4),
      cyl(0.14, 0.22, '#7a5230', { y: 1.28 }, 10, 0.16),
      cone(1.1, 0.3, '#8a4b32', { y: 2.3, ry: Math.PI / 4 }, 4),
    ],
  },
  cart: {
    solid: () => {
      const wood = '#9a6a44';
      const x = 0.45;
      const parts = [box(1.8, 0.12, 1.3, wood, { x, y: 0.55 })];
      for (const z of [-0.62, 0.62]) parts.push(box(1.8, 0.35, 0.06, wood, { x, y: 0.67, z }));
      for (const dx of [-0.87, 0.87]) parts.push(box(0.06, 0.35, 1.3, wood, { x: x + dx, y: 0.67 }));
      for (const z of [-0.69, 0.69]) parts.push(wheel(0.45, 0.1, '#5e3f24', { x, y: 0.45, z }), wheel(0.1, 0.14, '#3d3d44', { x, y: 0.45, z }));
      for (const z of [-0.45, 0.45]) parts.push(box(0.9, 0.06, 0.06, wood, { x: -0.9, y: 0.5, z }));
      parts.push(ball(0.75, '#e3c35a', { x, y: 1.0, sx: 1.15, sy: 0.9, sz: 0.8 }));
      return parts;
    },
  },
  haybale: {
    solid: () => {
      const roll = (r: number, len: number, color: string, x = 0) => part(new CylinderGeometry(r, r, len, 14), color, { sz: 1.1, rz: Math.PI / 2, x, y: 0.5 });
      return [roll(0.5, 1.6, '#e3c35a'), roll(0.505, 0.06, '#a8823a', -0.45), roll(0.505, 0.06, '#a8823a', 0.45)];
    },
  },
  noticeboard: {
    solid: () => {
      const wood = '#7a5230';
      const parts = [box(0.16, 2.25, 0.16, wood, { x: -1.1 }), box(0.16, 2.25, 0.16, wood, { x: 1.1 })];
      parts.push(box(2.0, 1.4, 0.08, '#a8794a', { y: 0.75 }), box(2.1, 0.08, 0.12, wood, { y: 0.7 }), box(2.1, 0.08, 0.12, wood, { y: 2.12 }));
      parts.push(box(2.4, 0.08, 0.4, '#5e3f24', { y: 2.25 }), box(2.4, 0.07, 0.12, '#5e3f24', { y: 2.33 }));
      const posters: [number, number, number, number, string, number][] = [
        [-0.6, 1.0, 0.5, 0.65, '#f1e3c0', 0.05],
        [0.05, 1.3, 0.45, 0.55, '#e8d6a8', -0.04],
        [0.62, 0.92, 0.55, 0.42, '#f4ead0', 0.02],
      ];
      for (const side of [-1, 1]) {
        for (const [x, y, w, h, color, rz] of posters) {
          parts.push(box(w, h, 0.01, color, { x, y, z: side * 0.045, rz }));
          for (let i = 0; i < 3; i++) parts.push(box(w * 0.7, 0.025, 0.012, '#5b4636', { x, y: y + h * (0.65 - i * 0.18), z: side * 0.046, rz }));
        }
        parts.push(ball(0.04, '#c0392b', { x: -0.6, y: 1.12, z: side * 0.055 }, 0));
      }
      return parts;
    },
  },
  /* ---------- the present ---------- */
  car: {
    tints: ['#e63946', '#3a86ff', '#f4a261', '#2a9d8f', '#f1f1f1', '#ffd166', '#6c757d'],
    solid: () => {
      const parts = [box(4.2, 0.6, 1.8, '#ffffff', { y: 0.3 }), box(2.2, 0.55, 1.6, '#ffffff', { x: -0.2, y: 0.9 }), box(2.0, 0.05, 1.5, '#ffffff', { x: -0.2, y: 1.45 })];
      parts.push(box(0.05, 0.42, 1.5, GLASS, { x: 0.92, y: 0.97 }), box(0.05, 0.42, 1.5, GLASS, { x: -1.32, y: 0.97 }), box(1.9, 0.38, 1.62, GLASS, { x: -0.2, y: 1.0 }));
      for (const x of [-2.06, 2.06]) parts.push(box(0.08, 0.18, 1.8, '#3a3f47', { x, y: 0.3 }));
      for (const x of [-1.35, 1.35]) for (const z of [-0.82, 0.82]) parts.push(wheel(0.34, 0.24, TYRE, { x, y: 0.34, z }));
      return parts;
    },
    glow: () => [
      ...[-0.6, 0.6].map((z) => box(0.04, 0.12, 0.3, '#fff3c4', { x: 2.09, y: 0.62, z })),
      ...[-0.65, 0.65].map((z) => box(0.04, 0.12, 0.3, '#ff3b3b', { x: -2.09, y: 0.62, z })),
    ],
  },
  bus: {
    tints: ['#ffd166', '#e63946', '#f1f1f1', '#3a86ff'],
    solid: () => {
      const parts = [box(10, 2.7, 2.5, '#ffffff', { y: 0.4 }), box(9.8, 0.1, 2.4, '#ffffff', { y: 3.1 })];
      parts.push(box(8.6, 0.9, 2.52, GLASS, { x: -0.4, y: 1.7 }), box(0.04, 1.3, 2.2, GLASS, { x: 4.98, y: 1.4 }), box(1.0, 2.0, 0.04, GLASS, { x: 3.8, y: 0.45, z: 1.26 }));
      parts.push(box(9.96, 0.15, 2.52, '#30343b', { y: 1.25 }), box(9.96, 0.25, 2.52, '#30343b', { y: 0.4 }));
      for (const x of [-3.4, 3.4]) for (const z of [-1.15, 1.15]) parts.push(wheel(0.5, 0.28, TYRE, { x, y: 0.5, z }));
      return parts;
    },
    glow: () => [
      box(0.04, 0.3, 1.6, '#ffb703', { x: 4.99, y: 2.75 }),
      ...[-0.9, 0.9].map((z) => box(0.04, 0.16, 0.36, '#fff3c4', { x: 4.99, y: 0.85, z })),
      ...[-0.95, 0.95].map((z) => box(0.04, 0.3, 0.2, '#ff3b3b', { x: -4.99, y: 0.9, z })),
    ],
  },
  container: {
    tints: ['#c44536', '#2a6f97', '#e9a03b', '#3c8d5a', '#7d8597', '#6a4c93'],
    solid: () => {
      const parts = [box(6, 2.6, 2.3, '#ffffff')];
      for (let i = 0; i < 19; i++) parts.push(box(0.08, 2.44, 2.38, '#dcdcdc', { x: -2.7 + i * 0.3, y: 0.08 }));
      for (const x of [-2.9, 2.9]) for (const z of [-1.1, 1.1]) for (const y of [0, 2.4]) parts.push(box(0.2, 0.2, 0.2, '#3a3f47', { x, y, z }));
      for (const x of [-2.96, 2.96]) {
        parts.push(box(0.1, 2.36, 0.04, '#9a9a9a', { x, y: 0.12 }));
        for (const z of [-0.6, -0.3, 0.3, 0.6]) parts.push(box(0.1, 2.2, 0.05, '#7a7a7a', { x, y: 0.2, z }));
      }
      return parts;
    },
  },
  vending: {
    tints: ['#d62839', '#1d6fb8', '#2a9d8f'],
    solid: () => [
      box(1.1, 1.9, 0.9, '#ffffff'),
      box(0.25, 0.4, 0.02, '#1f2328', { x: 0.35, y: 0.9, z: 0.45 }),
      box(0.65, 0.25, 0.03, '#1f2328', { x: -0.15, y: 0.12, z: 0.45 }),
      box(0.12, 0.04, 0.03, '#c9ced6', { x: 0.35, y: 1.42, z: 0.45 }),
    ],
    glow: () => {
      const parts = [box(0.65, 1.3, 0.02, '#bde0fe', { x: -0.15, y: 0.45, z: 0.45 }), box(1.0, 0.18, 0.02, '#ffffff', { y: 1.65, z: 0.45 })];
      const cans = ['#e63946', '#ffd166', '#06d6a0', '#3a86ff'];
      for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) parts.push(box(0.1, 0.18, 0.02, cans[(row + col) % 4]!, { x: -0.39 + col * 0.16, y: 0.55 + row * 0.3, z: 0.46 }));
      return parts;
    },
  },
  dumpster: {
    tints: ['#2a9d8f', '#3c6e47', '#1d6fb8', '#6c757d'],
    solid: () => {
      const parts = [box(2, 1.07, 1.25, '#ffffff', { y: 0.15 }), box(2, 0.08, 1.3, '#ffffff', { y: 1.22 })];
      parts.push(part(new BoxGeometry(1.96, 0.08, 1.3), '#2b2d31', { y: 1.35, rx: 0.06 }));
      for (const x of [-0.85, 0.85]) for (const z of [-0.5, 0.5]) parts.push(cyl(0.08, 0.15, TYRE, { x, z }, 8));
      for (const x of [-1.02, 1.02]) parts.push(box(0.04, 0.06, 0.9, '#3a3f47', { x, y: 0.9 }));
      return parts;
    },
  },
  barrier: {
    tints: ['#ffffff', '#f2eee6'],
    solid: () => {
      const concrete = '#b9b5ac';
      const parts = [box(3, 0.25, 0.6, concrete), box(3, 0.3, 0.42, concrete, { y: 0.25 }), box(3, 0.35, 0.26, concrete, { y: 0.55 })];
      for (let i = 0; i < 6; i++) for (const z of [-0.135, 0.135]) parts.push(box(0.5, 0.22, 0.01, i % 2 ? '#f4f4f4' : '#e63946', { x: -1.25 + i * 0.5, y: 0.62, z }));
      return parts;
    },
  },
  billboard: {
    solid: () => [box(5, 0.6, 0.6, '#8d939b'), box(5, 3.0, 0.45, '#2b2f36', { y: 0.6 }), box(5.0, 0.06, 0.5, '#4a4f58', { y: 3.54 })],
    glow: () => {
      const parts: BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        const z = side * 0.235;
        const front = side * 0.25;
        parts.push(box(4.6, 2.6, 0.02, '#1b2a4a', { y: 0.8, z }));
        parts.push(wheel(0.7, 0.02, '#ffd166', { x: -1.3, y: 2.1, z: front }));
        parts.push(box(2.0, 0.28, 0.02, '#ffffff', { x: 0.9, y: 2.5, z: front }));
        parts.push(box(1.6, 0.2, 0.02, '#ff4d6d', { x: 0.7, y: 2.05, z: front }));
        parts.push(box(1.8, 0.16, 0.02, '#a0c4ff', { x: 0.8, y: 1.6, z: front }));
        parts.push(box(4.6, 0.3, 0.02, '#ff4d6d', { y: 0.95, z: front }));
      }
      return parts;
    },
  },
  /* ---------- the future ---------- */
  reactor: {
    solid: () => [
      cyl(1.3, 0.4, HULL_DARK, {}, 16),
      ...around(4, 0.95, (p) => box(0.25, 2.3, 0.25, HULL, { ...p, y: 0.4 }), {}, Math.PI / 4),
      part(new TorusGeometry(1.0, 0.08, 6, 24), HULL, { rx: Math.PI / 2, y: 1.6 }),
      cyl(1.2, 0.3, HULL_DARK, { y: 2.7 }, 16),
      cyl(0.6, 0.1, HULL, { y: 2.6 }, 16),
    ],
    glow: () => [
      cyl(0.55, 2.2, CYAN, { y: 0.4 }, 14),
      part(new TorusGeometry(0.75, 0.05, 6, 24), '#90e0ef', { rx: Math.PI / 2, y: 1.0 }),
      part(new TorusGeometry(0.75, 0.05, 6, 24), '#90e0ef', { rx: Math.PI / 2, y: 2.2 }),
      part(new TorusGeometry(1.26, 0.03, 4, 32), CYAN, { rx: Math.PI / 2, y: 0.42 }),
    ],
  },
  forcefield: {
    solid: () => [box(3.2, 0.15, 0.3, HULL), ...[-1.8, 1.8].map((x) => box(0.4, 2.2, 0.5, HULL_DARK, { x }))],
    glow: () => [
      box(3.2, 1.85, 0.08, '#7bdff2', { y: 0.15 }),
      ...[0.5, 0.9, 1.3, 1.7].map((y) => box(3.2, 0.03, 0.1, '#e0fbfc', { y })),
      ...[-1.8, 1.8].map((x) => box(0.42, 0.08, 0.52, '#ff4d6d', { x, y: 2.0 })),
    ],
  },
  crystal: {
    tints: ['#ffffff', '#a0f0ff', '#ffd6a5'],
    solid: () => {
      const shard = (r: number, stretch: number, color: string, x: number, z: number, rz: number, rx = 0) =>
        part(new OctahedronGeometry(r, 0), color, { sy: stretch, x: x + Math.sin(-rz) * r * stretch, y: Math.cos(rz) * r * stretch + 0.15, z: z + Math.sin(rx) * r * stretch, rz, rx });
      return [
        part(new DodecahedronGeometry(0.7, 0), '#4a4e69', { y: 0.2, sy: 0.45 }),
        part(new DodecahedronGeometry(0.4, 0), '#3d405b', { x: 0.45, y: 0.12, z: -0.3, sy: 0.5 }),
        shard(0.32, 3.5, '#b388ff', 0, 0, 0),
        shard(0.22, 2.6, '#c77dff', 0.35, 0.1, -0.45),
        shard(0.2, 2.4, '#9d4edd', -0.32, -0.15, 0.5),
        shard(0.17, 2.2, '#e0aaff', 0.05, 0.38, 0.1, 0.5),
      ];
    },
    glow: () => [ball(0.24, '#e0aaff', { y: 0.32 }, 1)],
  },
  dish: {
    solid: () => [
      cyl(0.6, 0.3, HULL_DARK, {}, 12),
      cyl(0.15, 2.0, HULL, { y: 0.3 }, 10),
      ball(0.22, HULL_DARK, { y: 2.3 }),
      // A shallow spherical cap, flipped to open upwards and tipped back towards -z.
      part(new SphereGeometry(1.6, 18, 5, 0, Math.PI * 2, 0, 0.7), '#c9d0d8', { rx: Math.PI - 0.6, y: 3.62, z: -0.906 }),
      // Its inside: the same cap mirrored (which turns its faces inwards), so the bowl shows from above.
      part(new SphereGeometry(1.6, 18, 5, 0, Math.PI * 2, 0, 0.7), '#f2f5f8', { sx: -1, rx: Math.PI - 0.6, y: 3.62, z: -0.906 }),
      part(new CylinderGeometry(0.03, 0.03, 0.9, 5), HULL, { rx: -0.6, y: 2.67, z: -0.255 }),
    ],
    glow: () => [ball(0.09, '#ff4d6d', { y: 3.04, z: -0.51 }, 1)],
  },
  rover: {
    tints: ['#ffffff', '#ffd6a5', '#cfe8ff'],
    solid: () => {
      const body = '#e8ecf1';
      const parts = [box(2.6, 0.5, 1.4, body, { y: 0.55 }), box(1.0, 0.55, 1.3, body, { x: 0.7, y: 1.05 }), box(0.05, 0.35, 1.1, GLASS, { x: 1.21, y: 1.12 })];
      parts.push(box(1.2, 0.04, 1.5, '#1d3557', { x: -0.5, y: 1.05 }), box(1.2, 0.02, 0.02, '#8d99ae', { x: -0.5, y: 1.09 }));
      parts.push(cyl(0.05, 0.55, HULL, { x: -0.8, y: 1.05 }, 6), box(0.25, 0.2, 0.2, HULL_DARK, { x: -0.8, y: 1.6 }));
      for (const x of [-1.0, 0, 1.0]) for (const z of [-0.86, 0.86]) parts.push(wheel(0.38, 0.28, TYRE, { x, y: 0.38, z }), wheel(0.16, 0.3, HULL, { x, y: 0.38, z }));
      return parts;
    },
    glow: () => [...[-0.45, 0.45].map((z) => box(0.03, 0.08, 0.2, '#e0fbfc', { x: 1.21, y: 0.75, z })), ball(0.05, CYAN, { x: -0.67, y: 1.7 }, 0)],
  },
  pylon: {
    solid: () => [
      cyl(0.45, 0.3, HULL_DARK, {}, 8),
      cyl(0.25, 3.4, HULL, { y: 0.3 }, 6, 0.15),
      ...around(3, 0.3, (p) => box(0.06, 1.6, 0.25, HULL_DARK, { ...p, y: 0.3 })),
    ],
    glow: () => [
      ball(0.2, CYAN, { y: 3.8 }, 1),
      ...around(3, 0.43, (p) => box(0.04, 1.4, 0.03, CYAN, { ...p, y: 0.4 })),
      part(new TorusGeometry(0.21, 0.025, 4, 16), CYAN, { rx: Math.PI / 2, y: 2.4 }),
      part(new TorusGeometry(0.19, 0.025, 4, 16), CYAN, { rx: Math.PI / 2, y: 3.0 }),
    ],
  },
  hologram: {
    solid: () => [box(4, 0.5, 0.6, HULL_DARK), ...[-1.875, 1.875].map((x) => box(0.25, 3.2, 0.4, HULL, { x })), box(4, 0.12, 0.4, HULL_DARK, { y: 3.08 })],
    glow: () => {
      // Scan lines with slits between them, so the sign reads as projected light.
      const parts = Array.from({ length: 12 }, (_, i) => box(3.5, 0.19, 0.04, i % 2 ? CYAN : '#3aa8cc', { y: 0.55 + i * 0.2 }));
      parts.push(box(3.6, 0.04, 0.3, CYAN, { y: 0.5 }));
      parts.push(part(new TorusGeometry(0.55, 0.05, 6, 24), '#e0fbfc', { x: -0.8, y: 1.8 }), ball(0.35, '#b5f5ff', { x: -0.8, y: 1.8, sz: 0.4 }));
      parts.push(box(1.4, 0.16, 0.06, '#e0fbfc', { x: 0.85, y: 2.2 }), box(1.1, 0.12, 0.06, '#ff9de2', { x: 0.7, y: 1.8 }), box(1.3, 0.12, 0.06, '#e0fbfc', { x: 0.8, y: 1.45 }));
      return parts;
    },
  },
};

/** Scale geometry modelled at a prop's catalogue size down to the unit footprint. */
function normalise(kind: PropKind, geometry: BufferGeometry): BufferGeometry {
  const { width, depth, height } = PROPS[kind].size;
  return geometry.scale(1 / width, 1 / height, 1 / (PROPS[kind].shape === 'circle' ? width : depth));
}

const merge = (kind: PropKind, parts: BufferGeometry[] | undefined): BufferGeometry | null =>
  parts && parts.length > 0 ? normalise(kind, mergeGeometries(parts)!) : null;

const cache = new Map<PropKind, Model>();

/** The model for a prop kind, built once per page. */
export function modelFor(kind: PropKind): Model {
  let model = cache.get(kind);
  if (!model) {
    const recipe = RECIPES[kind];
    model = {
      solid: merge(kind, recipe.solid?.()),
      faced: recipe.faced ? new BoxGeometry(1, 1, 1).translate(0, 0.5, 0) : null,
      glow: merge(kind, recipe.glow?.()),
      tints: recipe.tints ?? ['#ffffff'],
    };
    cache.set(kind, model);
  }
  return model;
}
