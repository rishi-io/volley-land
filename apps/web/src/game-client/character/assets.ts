import type { Accessory, WeaponId } from '@volleyland/game-core';
import {
  type BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  RingGeometry,
  SphereGeometry,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  BoxGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Shared character assets. Built once per page and shared by every character, so a room full
 * of players costs a handful of geometries and materials. Each character is two meshes: the
 * body (head and torso, in the player's colour) and the details (eyes, accessory, bot marker,
 * merged into one mesh with vertex colours).
 */

/** Body proportions for a player of the given collision size. */
export function proportions(radius: number, height: number) {
  const headR = Math.min(radius * 0.86, height * 0.24);
  const headY = height - headR;
  const torsoR = radius * 0.92;
  const torsoTop = headY - headR * 0.55;
  const torsoLength = Math.max(torsoTop - torsoR * 2, 0.01);
  return { headR, headY, torsoR, torsoLength, torsoY: torsoR + torsoLength / 2, height, radius };
}
type Proportions = ReturnType<typeof proportions>;

/** Paint a geometry one colour (vertex colours), then scale and move it into place. Rotate before calling. */
function part(geometry: BufferGeometry, color: string, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): BufferGeometry {
  geometry.scale(sx, sy, sz);
  geometry.translate(x, y, z);
  const c = new Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

const cache = new Map<string, BufferGeometry>();
const cached = (key: string, build: () => BufferGeometry) => {
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = build();
    cache.set(key, geometry);
  }
  return geometry;
};

export function bodyGeometry(p: Proportions): BufferGeometry {
  return cached(`body:${p.radius}:${p.height}`, () =>
    mergeGeometries([
      part(new CapsuleGeometry(p.torsoR, p.torsoLength, 4, 14), '#ffffff', 0, p.torsoY, 0),
      part(new SphereGeometry(p.headR, 16, 12), '#ffffff', 0, p.headY, 0),
    ])!,
  );
}

function eyes(p: Proportions): BufferGeometry[] {
  const er = p.headR * 0.26;
  const ex = p.headR * 0.38;
  const ey = p.headY + p.headR * 0.12;
  const ez = p.headR * 0.84;
  return [-1, 1].flatMap((side) => [
    part(new SphereGeometry(er, 10, 8), '#ffffff', side * ex, ey, ez, 1, 1.15, 0.6),
    part(new SphereGeometry(er * 0.55, 8, 6), '#141821', side * ex, ey - er * 0.05, ez + er * 0.42, 1, 1.1, 0.6),
  ]);
}

function accessoryParts(p: Proportions, accessory: Accessory): BufferGeometry[] {
  const { headR: r, headY: y } = p;
  const top = y + r;
  switch (accessory) {
    case 'cap':
      return [
        part(new SphereGeometry(r * 1.04, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#ef476f', 0, y + r * 0.12, 0),
        part(new CylinderGeometry(r * 0.75, r * 0.75, r * 0.07, 16, 1, false, -Math.PI / 2, Math.PI), '#ef476f', 0, y + r * 0.2, r * 0.45),
      ];
    case 'beanie':
      return [
        part(new SphereGeometry(r * 1.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), '#f1faee', 0, y + r * 0.08, 0),
        part(new SphereGeometry(r * 0.24, 8, 6), '#e63946', 0, top + r * 0.12, 0),
      ];
    case 'headband':
      return [part(new TorusGeometry(r * 0.98, r * 0.1, 6, 20).rotateX(Math.PI / 2), '#e63946', 0, y + r * 0.45, 0)];
    case 'sprout':
      return [
        part(new CylinderGeometry(r * 0.05, r * 0.05, r * 0.45, 6), '#40916c', 0, top + r * 0.18, 0),
        part(new SphereGeometry(r * 0.22, 8, 6), '#52b788', -r * 0.2, top + r * 0.42, 0, 1.4, 0.45, 0.8),
        part(new SphereGeometry(r * 0.22, 8, 6), '#52b788', r * 0.2, top + r * 0.42, 0, 1.4, 0.45, 0.8),
      ];
    case 'crown':
      return [
        part(new CylinderGeometry(r * 0.55, r * 0.55, r * 0.22, 14, 1, true), '#ffd166', 0, top - r * 0.02, 0),
        ...[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return part(new ConeGeometry(r * 0.12, r * 0.3, 6), '#ffd166', Math.sin(a) * r * 0.5, top + r * 0.22, Math.cos(a) * r * 0.5);
        }),
      ];
    case 'horns':
      return [-1, 1].map((side) => part(new ConeGeometry(r * 0.16, r * 0.5, 8).rotateZ(-side * 0.35), '#f1faee', side * r * 0.62, top - r * 0.05, 0));
  }
}

/** A visor band all round the head (readable from behind, where the game camera sits) and an antenna. */
function botMarkerParts(p: Proportions): BufferGeometry[] {
  const { headR: r, headY: y } = p;
  return [
    part(new CylinderGeometry(r * 1.04, r * 1.04, r * 0.48, 20, 1, true), '#1b263b', 0, y + r * 0.1, 0),
    part(new BoxGeometry(r * 1.1, r * 0.14, r * 0.06), '#4cc9f0', 0, y + r * 0.12, r * 1.03),
    part(new CylinderGeometry(r * 0.07, r * 0.07, r * 0.9, 6), '#adb5bd', 0, y + r * 1.3, 0),
    part(new SphereGeometry(r * 0.24, 10, 8), '#ef476f', 0, y + r * 1.8, 0),
  ];
}

/** Eyes plus accessory (humans) or visor and antenna (bots with the marker on), as one mesh. */
export function detailGeometry(p: Proportions, options: { accessory: Accessory | null; bot: boolean }): BufferGeometry {
  const key = `detail:${p.radius}:${p.height}:${options.bot ? 'bot' : (options.accessory ?? 'none')}`;
  return cached(key, () => {
    const parts = options.bot ? botMarkerParts(p) : [...eyes(p), ...(options.accessory ? accessoryParts(p, options.accessory) : [])];
    return mergeGeometries(parts)!;
  });
}

/**
 * A blaster as one mesh with vertex colours, in metres at hand size: the grip at the origin and the
 * barrel along +z. Low-poly sci-fi shapes from primitives, the glowing parts in the weapon's bolt
 * colour. The ball has no gun (null).
 */
export function gunGeometry(weapon: WeaponId): BufferGeometry | null {
  if (weapon === 'ball') return null;
  return cached(`gun:${weapon}`, () => mergeGeometries(gunParts(weapon))!);
}

const barrel = (radius: number, length: number, color: string, x: number, y: number, z: number) =>
  part(new CylinderGeometry(radius, radius, length, 10).rotateX(Math.PI / 2), color, x, y, z);
const ring = (radius: number, color: string, x: number, y: number, z: number) => part(new TorusGeometry(radius, radius * 0.28, 6, 14), color, x, y, z);
const grip = (color: string) => part(new BoxGeometry(0.045, 0.11, 0.06).rotateX(-0.25), color, 0, -0.05, -0.02);

function gunParts(weapon: Exclude<WeaponId, 'ball'>): BufferGeometry[] {
  switch (weapon) {
    case 'blaster':
      return [
        part(new BoxGeometry(0.07, 0.085, 0.26), '#5c677d', 0, 0.03, 0.06),
        part(new BoxGeometry(0.02, 0.035, 0.14), '#8d99ae', 0, 0.09, 0.04),
        barrel(0.022, 0.12, '#adb5bd', 0, 0.035, 0.24),
        ring(0.03, '#4cc9f0', 0, 0.035, 0.29),
        part(new BoxGeometry(0.075, 0.02, 0.1), '#4cc9f0', 0, 0.0, 0.08),
        grip('#33415c'),
      ];
    case 'scatter':
      return [
        part(new BoxGeometry(0.11, 0.1, 0.28), '#7f5539', 0, 0.035, 0.07),
        part(new BoxGeometry(0.12, 0.03, 0.08), '#ff7b00', 0, 0.035, 0.2),
        ...[-0.033, 0, 0.033].map((x) => barrel(0.017, 0.12, '#adb5bd', x, 0.04, 0.27)),
        ...[-0.033, 0, 0.033].map((x) => ring(0.019, '#ff7b00', x, 0.04, 0.33)),
        grip('#463f3a'),
      ];
    case 'rail':
      return [
        part(new BoxGeometry(0.065, 0.075, 0.42), '#415a77', 0, 0.03, 0.1),
        part(new BoxGeometry(0.035, 0.04, 0.12), '#1b263b', 0, 0.1, 0.08),
        barrel(0.016, 0.36, '#adb5bd', 0, 0.035, 0.48),
        ...[0.36, 0.44, 0.52].map((z) => ring(0.03, '#f72585', 0, 0.035, z)),
        part(new BoxGeometry(0.06, 0.016, 0.3), '#f72585', 0, -0.012, 0.12),
        grip('#33415c'),
      ];
  }
}

export const shadowGeometry = (radius: number) => cached(`shadow:${radius}`, () => new CircleGeometry(radius * 1.15, 24).rotateX(-Math.PI / 2));
export const ringGeometry = (radius: number) => cached(`ring:${radius}`, () => new RingGeometry(radius * 1.15, radius * 1.4, 32).rotateX(-Math.PI / 2));
/** A faceted ice block around a frozen character, stretched to its height. */
export const iceGeometry = (radius: number, height: number) =>
  cached(`ice:${radius}:${height}`, () => new IcosahedronGeometry(radius * 1.6, 0).scale(1, height / (radius * 2.6), 1));

let shared: ReturnType<typeof buildShared> | null = null;

/** Materials and textures every character shares. */
export function sharedAssets() {
  shared ??= buildShared();
  return shared;
}

function buildShared() {
  // Three-step toon ramp: flat, readable shading at the cost of plain Lambert.
  const ramp = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
  ramp.minFilter = ramp.magFilter = NearestFilter;
  ramp.needsUpdate = true;

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 64;
  const ctx = shadowCanvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  return {
    ramp,
    details: new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }),
    shadow: new MeshBasicMaterial({ map: new CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }),
    ownRing: new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false }),
    shield: new MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.85, depthWrite: false }),
    ice: new MeshToonMaterial({ color: '#bde0fe', gradientMap: ramp, transparent: true, opacity: 0.5, depthWrite: false }),
    barBack: new SpriteMaterial({ color: '#0b0f18', transparent: true, opacity: 0.75, depthWrite: false }),
    barFill: {
      good: new SpriteMaterial({ color: '#06d6a0', depthWrite: false }),
      warn: new SpriteMaterial({ color: '#ffd166', depthWrite: false }),
      low: new SpriteMaterial({ color: '#ef476f', depthWrite: false }),
    },
  };
}

/** A body material per character: it carries the player colour, hit flash and frost tint. */
export function bodyMaterial(color: string): MeshToonMaterial {
  return new MeshToonMaterial({ color, gradientMap: sharedAssets().ramp });
}

const labelCache = new Map<string, { material: SpriteMaterial; aspect: number }>();

/** A crisp text label as a sprite material, cached by text ("You", "Bot 2", "Player"). */
export function labelMaterial(text: string): { material: SpriteMaterial; aspect: number } {
  let label = labelCache.get(text);
  if (!label) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const font = '600 44px system-ui, sans-serif';
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width) + 36;
    canvas.width = width;
    canvas.height = 64;
    ctx.font = font;
    ctx.fillStyle = 'rgba(11,15,24,0.72)';
    ctx.beginPath();
    ctx.roundRect(0, 4, width, 56, 28);
    ctx.fill();
    ctx.fillStyle = '#e8ecf4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, 34);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    label = { material: new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }), aspect: width / 64 };
    labelCache.set(text, label);
  }
  return label;
}
