import { type BufferGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, SphereGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOOK_COLORS, type Model, ball, box, cyl, part, rng } from './models';
import type { DecorKind } from './themes';

/*
 * Models for floor decorations and for scenery that only stands outside the floor. Unlike props
 * these are modelled at their real size (instances only vary them a little), and never collide.
 */

type Recipe = { solid?: () => BufferGeometry[]; glow?: () => BufferGeometry[]; tints?: string[] };

const RECIPES: Record<DecorKind | 'building' | 'stack', Recipe> = {
  tuft: {
    tints: ['#ffffff', '#e6f2d0', '#d4e8b8'],
    solid: () =>
      [0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return part(new ConeGeometry(0.035, 0.32, 4), '#5c9a40', { x: Math.cos(a) * 0.06, z: Math.sin(a) * 0.06, y: 0.15, rx: Math.sin(a) * 0.35, rz: -Math.cos(a) * 0.35 });
      }),
  },
  flower: {
    tints: ['#ff6b8b', '#ffd166', '#ffffff', '#c77dff', '#ff9f43'],
    solid: () => [
      cyl(0.015, 0.28, '#4f8c3b', {}, 4),
      ...[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return part(new SphereGeometry(0.05, 5, 3), '#ffffff', { x: Math.cos(a) * 0.06, z: Math.sin(a) * 0.06, y: 0.29, sy: 0.4 });
      }),
      ball(0.035, '#ffcf3f', { y: 0.3 }, 0),
    ],
  },
  pebble: {
    tints: ['#ffffff', '#d9d4cc', '#bfc4cc'],
    solid: () => [part(new DodecahedronGeometry(0.12, 0), '#9a9a9a', { y: 0.04, sy: 0.5 })],
  },
  shell: {
    tints: ['#ffd6d6', '#fff3e0', '#ffe0b2', '#f8bbd0'],
    solid: () => [part(new SphereGeometry(0.11, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', { sy: 0.45, sx: 1.2 }), part(new ConeGeometry(0.05, 0.1, 5), '#ffffff', { rz: Math.PI / 2, x: -0.14, y: 0.02 })],
  },
  leaf: {
    tints: ['#e76f51', '#f4a261', '#e9c46a', '#c0392b'],
    solid: () => [part(new CircleGeometry(0.09, 6), '#ffffff', { rx: -Math.PI / 2, y: 0.01, sx: 1.6 })],
  },
  snowlump: {
    solid: () => [part(new SphereGeometry(0.35, 8, 5), '#f7fbff', { sy: 0.35 }), part(new SphereGeometry(0.22, 7, 4), '#f2f7fc', { x: 0.25, z: 0.1, sy: 0.4 })],
  },
  twig: {
    solid: () => [part(new CylinderGeometry(0.015, 0.02, 0.5, 4), '#5c4030', { rz: Math.PI / 2, y: 0.02 }), part(new CylinderGeometry(0.01, 0.012, 0.2, 4), '#5c4030', { rz: Math.PI / 2, ry: 0.6, x: 0.12, z: -0.05, y: 0.02 })],
  },
  books: {
    solid: () => {
      const r = rng(23);
      return [0, 1, 2].map((i) => box(0.32 - i * 0.03, 0.06, 0.24, BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]!, { y: i * 0.06, ry: (r() - 0.5) * 0.6 }));
    },
  },
  floorlight: {
    solid: () => [box(0.5, 0.03, 0.5, '#3d4654')],
    glow: () => [box(0.36, 0.035, 0.36, '#7fdcff')],
  },
  building: {
    solid: () => {
      const parts = [box(16, 7, 9, '#e3d9c6'), box(16.6, 0.5, 9.6, '#a9483a', { y: 7 }), box(3, 2.6, 0.2, '#6b4a32', { z: 4.55 })];
      for (const y of [1.2, 4.2]) {
        for (let i = 0; i < 6; i++) {
          const x = -6.25 + i * 2.5;
          // The door takes the middle of the ground floor at the front.
          if (!(y < 2 && Math.abs(x) < 2)) parts.push(box(1.6, 1.6, 0.12, '#7fb3d5', { x, y, z: 4.52 }));
          parts.push(box(1.6, 1.6, 0.12, '#7fb3d5', { x, y, z: -4.52 }));
        }
      }
      return parts;
    },
  },
  stack: {
    solid: () => {
      const r = rng(31);
      const parts: BufferGeometry[] = [];
      let y = 0;
      for (let i = 0; i < 9; i++) {
        const h = 0.08 + r() * 0.06;
        parts.push(box(0.5 + r() * 0.2, h, 0.38, BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)]!, { y, ry: (r() - 0.5) * 0.5 }));
        y += h;
      }
      return parts;
    },
  },
};

const cache = new Map<string, Model>();

/** The model for a decoration or scenery-only kind, at real size. */
export function decorModel(kind: DecorKind | 'building' | 'stack'): Model {
  let model = cache.get(kind);
  if (!model) {
    const recipe = RECIPES[kind];
    const solid = recipe.solid?.();
    const glow = recipe.glow?.();
    model = {
      solid: solid && solid.length > 0 ? mergeGeometries(solid) : null,
      faced: null,
      glow: glow && glow.length > 0 ? mergeGeometries(glow) : null,
      tints: recipe.tints ?? ['#ffffff'],
    };
    cache.set(kind, model);
  }
  return model;
}
