import type { SurfaceId } from '@volleyland/game-core';
import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/*
 * Procedural ground and wall textures, painted once per page on small canvases: no image
 * downloads, and they tile in world space (see materials.ts), so a 2 m path and a 200 m floor
 * show the same detail. Each has a base colour, which the minimap and the admin plan reuse.
 */

/** Wall and block facings, beyond the floor surfaces. */
export type FacingId = 'brick' | 'stone' | 'plaster' | 'icebrick' | 'panel' | 'woodpanel' | 'slate';
export type TextureId = SurfaceId | FacingId;

interface Painter {
  /** Main colour: what the texture averages to. */
  base: string;
  /** Metres covered by one repeat of the texture. */
  tile: number;
  paint: (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void;
}

const SIZE = 256;

/** A tiny deterministic random source, so textures look the same on every load. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rand: () => number, colors: string[], count: number, min = 1, max = 3) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)]!;
    const r = min + rand() * (max - min);
    ctx.fillRect(rand() * size, rand() * size, r, r);
  }
}

/** Running-bond bricks or blocks with mortar lines. */
function bricks(ctx: CanvasRenderingContext2D, size: number, rand: () => number, rows: number, cols: number, colors: string[], mortar: string, gap: number) {
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, size, size);
  const h = size / rows;
  const w = size / cols;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : w / 2;
    for (let c = -1; c <= cols; c++) {
      ctx.fillStyle = colors[Math.floor(rand() * colors.length)]!;
      ctx.fillRect(c * w + offset + gap / 2, r * h + gap / 2, w - gap, h - gap);
    }
  }
}

const PAINTERS: Record<TextureId, Painter> = {
  court: {
    base: '#2b3a55',
    tile: 4,
    paint: (ctx, s) => {
      ctx.fillStyle = '#2b3a55';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = '#34466a';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo((i * s) / 4 + 1, 0);
        ctx.lineTo((i * s) / 4 + 1, s);
        ctx.moveTo(0, (i * s) / 4 + 1);
        ctx.lineTo(s, (i * s) / 4 + 1);
        ctx.stroke();
      }
      ctx.strokeStyle = '#41557a';
      ctx.strokeRect(1, 1, s, s);
    },
  },
  grass: {
    base: '#6aa84f',
    tile: 4,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#6aa84f';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rand, ['#5e9a45', '#78b65a', '#639f4a', '#82bf62'], 2600, 1, 4);
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 500; i++) {
        const x = rand() * s;
        const y = rand() * s;
        ctx.strokeStyle = rand() < 0.5 ? '#4f8c3b' : '#8fca6c';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 4, y - 3 - rand() * 4);
        ctx.stroke();
      }
    },
  },
  dirt: {
    base: '#9c7a54',
    tile: 3,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#9c7a54';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rand, ['#8c6c48', '#a8875f', '#7f6240', '#b39469'], 3000, 1, 4);
    },
  },
  sand: {
    base: '#e8d3a2',
    tile: 4,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#e8d3a2';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(190,160,110,0.25)';
      ctx.lineWidth = 3;
      for (let y = 10; y < s; y += 26) {
        ctx.beginPath();
        for (let x = 0; x <= s; x += 8) ctx.lineTo(x, y + Math.sin((x / s) * Math.PI * 4) * 4);
        ctx.stroke();
      }
      speckle(ctx, s, rand, ['#dcc492', '#f1dfb4', '#cfb582'], 3500, 1, 2);
    },
  },
  cobbles: {
    base: '#a7a39a',
    tile: 2,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#857f74';
      ctx.fillRect(0, 0, s, s);
      const n = 6;
      const cell = s / n;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          const jitter = () => (rand() - 0.5) * cell * 0.18;
          ctx.fillStyle = ['#a7a39a', '#b4b0a6', '#9a968c', '#aeaaa0'][Math.floor(rand() * 4)]!;
          ctx.beginPath();
          ctx.ellipse(c * cell + cell / 2 + jitter(), r * cell + cell / 2 + jitter(), cell * 0.43, cell * 0.4, rand() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  boards: {
    base: '#a87a4f',
    tile: 3,
    paint: (ctx, s, rand) => {
      const rows = 8;
      const h = s / rows;
      for (let r = 0; r < rows; r++) {
        ctx.fillStyle = ['#a87a4f', '#9b6f46', '#b3865a', '#a17349'][r % 4]!;
        ctx.fillRect(0, r * h, s, h);
        ctx.strokeStyle = 'rgba(80,50,25,0.35)';
        ctx.lineWidth = 1;
        for (let g = 0; g < 4; g++) {
          ctx.beginPath();
          const y = r * h + 3 + rand() * (h - 6);
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(s * 0.3, y + rand() * 3, s * 0.6, y - rand() * 3, s, y);
          ctx.stroke();
        }
        ctx.fillStyle = '#5e3f24';
        ctx.fillRect(0, r * h, s, 2);
        const joint = ((r * 0.37) % 1) * s;
        ctx.fillRect(joint, r * h, 2, h);
      }
    },
  },
  tiles: {
    base: '#d9dee6',
    tile: 2,
    paint: (ctx, s, rand) => {
      bricks(ctx, s, rand, 4, 4, ['#d9dee6', '#d2d8e1', '#e0e4eb'], '#aab2bf', 3);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(c * (s / 4) + (r % 2 ? s / 8 : 0) + 6, r * (s / 4) + 6, 10, 10);
      }
    },
  },
  carpet: {
    base: '#8e2c3a',
    tile: 2,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#8e2c3a';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rand, ['#842836', '#983244', '#7d2431'], 4000, 1, 2);
      ctx.strokeStyle = '#c9a24a';
      ctx.lineWidth = 3;
      const q = s / 4;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const x = c * q + q / 2;
          const y = r * q + q / 2;
          ctx.beginPath();
          ctx.moveTo(x, y - q * 0.3);
          ctx.lineTo(x + q * 0.3, y);
          ctx.lineTo(x, y + q * 0.3);
          ctx.lineTo(x - q * 0.3, y);
          ctx.closePath();
          ctx.stroke();
        }
      }
    },
  },
  snow: {
    base: '#eef4fa',
    tile: 4,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#eef4fa';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(170,195,225,${0.05 + rand() * 0.08})`;
        ctx.beginPath();
        ctx.ellipse(rand() * s, rand() * s, 10 + rand() * 30, 6 + rand() * 14, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      speckle(ctx, s, rand, ['#ffffff', '#dfe9f4'], 1500, 1, 2);
    },
  },
  ice: {
    base: '#bfe3f5',
    tile: 4,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#bfe3f5';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) {
        let x = rand() * s;
        let y = rand() * s;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          x += (rand() - 0.5) * 60;
          y += (rand() - 0.5) * 60;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let i = 0; i < 6; i++) ctx.fillRect(rand() * s, rand() * s, 40 + rand() * 40, 3);
    },
  },
  asphalt: {
    base: '#555b64',
    tile: 3,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#555b64';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rand, ['#4a5058', '#60666f', '#6b717a', '#43484f'], 5000, 1, 2);
    },
  },
  rubber: {
    base: '#c8553d',
    tile: 2,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#c8553d';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rand, ['#b84a33', '#d6654c', '#e1bf4f', '#3f8f6a'], 3000, 1, 3);
    },
  },
  metal: {
    base: '#7d8794',
    tile: 2,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#7d8794';
      ctx.fillRect(0, 0, s, s);
      // Diamond plate.
      ctx.fillStyle = '#8f99a6';
      for (let y = 0; y < s; y += 16) {
        for (let x = (y / 16) % 2 ? 8 : 0; x < s; x += 16) {
          ctx.save();
          ctx.translate(x + 4, y + 4);
          ctx.rotate(((y / 16) % 2 ? 1 : -1) * 0.7);
          ctx.fillRect(-5, -1.5, 10, 3);
          ctx.restore();
        }
      }
      ctx.strokeStyle = '#5b6470';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
      speckle(ctx, s, rand, ['rgba(255,255,255,0.08)'], 300, 1, 2);
    },
  },
  brick: {
    base: '#b5523b',
    tile: 1.5,
    paint: (ctx, s, rand) => bricks(ctx, s, rand, 8, 4, ['#b5523b', '#a9472f', '#c05e45', '#9e4430'], '#d8cfc0', 4),
  },
  stone: {
    base: '#cdb38a',
    tile: 2,
    paint: (ctx, s, rand) => bricks(ctx, s, rand, 4, 3, ['#cdb38a', '#c4a97f', '#d6bd95', '#bfa476'], '#a08a66', 4),
  },
  plaster: {
    base: '#e8e2d4',
    tile: 2,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#e8e2d4';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rand, ['#ded7c7', '#f0ebe0'], 2500, 1, 3);
      ctx.fillStyle = '#c9c1af';
      ctx.fillRect(0, s - 30, s, 30);
    },
  },
  icebrick: {
    base: '#9fd0ea',
    tile: 1.5,
    paint: (ctx, s, rand) => bricks(ctx, s, rand, 4, 3, ['#9fd0ea', '#8fc6e4', '#b0d9ef'], '#eaf6fc', 6),
  },
  panel: {
    base: '#9aa6b5',
    tile: 2,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#9aa6b5';
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = '#6f7b8a';
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, s - 4, s / 2 - 4);
      ctx.strokeRect(2, s / 2 + 2, s / 2 - 4, s / 2 - 4);
      ctx.strokeRect(s / 2 + 2, s / 2 + 2, s / 2 - 4, s / 2 - 4);
      ctx.fillStyle = '#5c6775';
      for (const [x, y] of [[12, 12], [s - 12, 12], [12, s / 2 - 12], [s - 12, s / 2 - 12]]) ctx.fillRect(x! - 3, y! - 3, 6, 6);
      ctx.fillStyle = '#ffcf4d';
      ctx.fillRect(s / 2 + 20, s - 40, s / 2 - 40, 8);
      speckle(ctx, s, rand, ['rgba(255,255,255,0.06)'], 200, 2, 4);
    },
  },
  woodpanel: {
    base: '#7a5235',
    tile: 2,
    paint: (ctx, s, rand) => {
      const cols = 6;
      const w = s / cols;
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = ['#7a5235', '#6f4a2f', '#835a3b'][c % 3]!;
        ctx.fillRect(c * w, 0, w, s);
        ctx.fillStyle = '#4e3220';
        ctx.fillRect(c * w, 0, 2, s);
      }
      speckle(ctx, s, rand, ['rgba(60,35,20,0.25)'], 800, 1, 3);
    },
  },
  slate: {
    base: '#5c6b8a',
    tile: 2,
    paint: (ctx, s, rand) => {
      ctx.fillStyle = '#5c6b8a';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rand, ['#566482', '#647394'], 1500, 1, 3);
      ctx.strokeStyle = '#4b5875';
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
    },
  },
};

export const textureBase = (id: TextureId): string => PAINTERS[id].base;
export const textureTile = (id: TextureId): number => PAINTERS[id].tile;

const cache = new Map<TextureId, Texture>();

/** The repeating texture for a surface or facing, painted on first use. */
export function textureFor(id: TextureId): Texture {
  let texture = cache.get(id);
  if (!texture) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    let seed = 0;
    for (const ch of id) seed = Math.imul(seed ^ ch.charCodeAt(0), 0x01000193);
    PAINTERS[id].paint(ctx, SIZE, seeded(seed));
    texture = new CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = 4;
    cache.set(id, texture);
  }
  return texture;
}
