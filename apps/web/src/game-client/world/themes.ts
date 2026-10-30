import type { PropKind, SurfaceId, ThemeId } from '@volleyland/game-core';
import type { FacingId } from './textures';

/** Small decorations scattered over the floor. They have no collision. */
export type DecorKind = 'tuft' | 'flower' | 'pebble' | 'shell' | 'leaf' | 'snowlump' | 'books' | 'floorlight' | 'twig';
/** Things placed round the outside of the floor: props, plus a few that only appear there. */
export type SceneryKind = PropKind | 'building' | 'stack';

export interface DecorRule {
  kind: DecorKind;
  /** Surfaces it can lie on; anywhere when omitted. */
  on?: SurfaceId[];
  weight: number;
  /** Share of the spots picked for it that it actually fills (default 1): for sparse things like floor lights. */
  chance?: number;
}

export interface BorderStyle {
  /** A low strip along the floor edge. */
  curb?: { height: number; width: number; color: string };
  posts?: { shape: 'box' | 'round' | 'mound'; width: number; height: number; spacing: number; color: string };
  /** Horizontal bars between posts, at these heights. */
  rails?: { heights: number[]; thickness: number; color: string; glow?: boolean };
}

export type Particles = 'leaves' | 'snow' | 'dust' | null;

export interface ThemeLook {
  sky: string;
  fog: { color: string; near: number; far: number };
  hemisphere: { sky: string; ground: string; intensity: number };
  sun: { color: string; intensity: number };
  /** Ground beyond the floor edge; null leaves empty space (the station floats among stars). */
  outside: { surface: SurfaceId; tint: string } | null;
  /** A sea round the outside ground (the beach). */
  water: string | null;
  facings: { block: FacingId | SurfaceId; wall: FacingId | SurfaceId };
  border: BorderStyle;
  decor: DecorRule[];
  scenery: { kinds: SceneryKind[]; density: number };
  particles: Particles;
  stars: boolean;
  /** Colours for the minimap and the admin plan: cover, low cover. */
  map: { prop: string; low: string };
}

export const THEME_LOOKS: Readonly<Record<ThemeId, ThemeLook>> = {
  classic: {
    sky: '#0f1420',
    fog: { color: '#0f1420', near: 45, far: 110 },
    hemisphere: { sky: '#dfe7ff', ground: '#1b2333', intensity: 1.1 },
    sun: { color: '#ffffff', intensity: 1.2 },
    outside: { surface: 'court', tint: '#3a4252' },
    water: null,
    facings: { block: 'slate', wall: 'slate' },
    border: { curb: { height: 0.12, width: 0.4, color: '#41557a' } },
    decor: [],
    scenery: { kinds: [], density: 0 },
    particles: null,
    stars: false,
    map: { prop: '#5c6b8a', low: '#8291b0' },
  },
  park: {
    sky: '#9fd3f5',
    fog: { color: '#bfe2f3', near: 50, far: 130 },
    hemisphere: { sky: '#fff6e0', ground: '#5d7a3a', intensity: 1.05 },
    sun: { color: '#fff1d0', intensity: 1.35 },
    outside: { surface: 'grass', tint: '#c7d9b8' },
    water: null,
    facings: { block: 'stone', wall: 'stone' },
    border: {
      posts: { shape: 'box', width: 0.14, height: 0.9, spacing: 2, color: '#f4ecd8' },
      rails: { heights: [0.35, 0.72], thickness: 0.08, color: '#f4ecd8' },
    },
    decor: [
      { kind: 'tuft', on: ['grass'], weight: 6 },
      { kind: 'flower', on: ['grass'], weight: 3 },
      { kind: 'pebble', on: ['dirt', 'cobbles'], weight: 2 },
      { kind: 'leaf', weight: 1 },
    ],
    scenery: { kinds: ['tree', 'tree', 'pine', 'hedge', 'rock'], density: 0.012 },
    particles: 'leaves',
    stars: false,
    map: { prop: '#2f6b2f', low: '#6fae5c' },
  },
  schoolyard: {
    sky: '#a8d8f0',
    fog: { color: '#c7e4f2', near: 50, far: 130 },
    hemisphere: { sky: '#fff8e8', ground: '#5a6066', intensity: 1.05 },
    sun: { color: '#fff3dc', intensity: 1.3 },
    outside: { surface: 'grass', tint: '#c9d7bd' },
    water: null,
    facings: { block: 'plaster', wall: 'brick' },
    border: {
      curb: { height: 0.1, width: 0.3, color: '#b9bec5' },
      posts: { shape: 'round', width: 0.1, height: 1.3, spacing: 3, color: '#7d8791' },
      rails: { heights: [0.15, 1.25], thickness: 0.05, color: '#9aa4ad' },
    },
    decor: [
      { kind: 'tuft', on: ['grass'], weight: 5 },
      { kind: 'leaf', weight: 2 },
      { kind: 'pebble', on: ['asphalt', 'rubber'], weight: 1 },
    ],
    scenery: { kinds: ['tree', 'tree', 'building', 'building'], density: 0.008 },
    particles: null,
    stars: false,
    map: { prop: '#6e3f34', low: '#b0897c' },
  },
  beach: {
    sky: '#8fd3ff',
    fog: { color: '#cbeeff', near: 55, far: 140 },
    hemisphere: { sky: '#fffaf0', ground: '#c9a86a', intensity: 1.1 },
    sun: { color: '#fff4dd', intensity: 1.4 },
    outside: { surface: 'sand', tint: '#f3ead8' },
    water: '#3fa7d6',
    facings: { block: 'stone', wall: 'boards' },
    border: {
      posts: { shape: 'round', width: 0.16, height: 0.8, spacing: 2.5, color: '#9c7a54' },
      rails: { heights: [0.6], thickness: 0.05, color: '#d8c39a' },
    },
    decor: [
      { kind: 'shell', on: ['sand', 'dirt'], weight: 4 },
      { kind: 'pebble', weight: 2 },
      { kind: 'tuft', on: ['sand'], weight: 1 },
    ],
    scenery: { kinds: ['palm', 'palm', 'rock'], density: 0.006 },
    particles: null,
    stars: false,
    map: { prop: '#8a6a3c', low: '#c8aa76' },
  },
  snow: {
    sky: '#cfe3f3',
    fog: { color: '#e4eef7', near: 40, far: 115 },
    hemisphere: { sky: '#f4f8ff', ground: '#9fb4c8', intensity: 1.15 },
    sun: { color: '#fff8f0', intensity: 1.1 },
    outside: { surface: 'snow', tint: '#ffffff' },
    water: null,
    facings: { block: 'snow', wall: 'icebrick' },
    border: { posts: { shape: 'mound', width: 1.4, height: 0.7, spacing: 1.6, color: '#f7fbff' } },
    decor: [
      { kind: 'snowlump', on: ['snow'], weight: 5 },
      { kind: 'twig', on: ['snow'], weight: 2 },
      { kind: 'pebble', on: ['snow'], weight: 1 },
    ],
    scenery: { kinds: ['pine', 'pine', 'pine', 'rock', 'snowman'], density: 0.014 },
    particles: 'snow',
    stars: false,
    map: { prop: '#4f7aa0', low: '#9cc0dd' },
  },
  library: {
    sky: '#2b1f17',
    fog: { color: '#2b1f17', near: 45, far: 110 },
    hemisphere: { sky: '#ffe9c4', ground: '#4a3020', intensity: 1.1 },
    sun: { color: '#ffe2b0', intensity: 1.1 },
    outside: { surface: 'boards', tint: '#8a7a6c' },
    water: null,
    facings: { block: 'woodpanel', wall: 'woodpanel' },
    border: {
      posts: { shape: 'box', width: 0.16, height: 1.0, spacing: 2, color: '#5a3d29' },
      rails: { heights: [0.95], thickness: 0.1, color: '#7a5235' },
    },
    decor: [
      { kind: 'books', on: ['boards', 'carpet', 'tiles'], weight: 3 },
      { kind: 'leaf', on: ['boards', 'carpet'], weight: 1 },
    ],
    scenery: { kinds: ['bookshelf', 'bookshelf', 'pillar', 'stack'], density: 0.012 },
    particles: 'dust',
    stars: false,
    map: { prop: '#5a3d29', low: '#a17a58' },
  },
  space: {
    sky: '#05070f',
    fog: { color: '#05070f', near: 60, far: 160 },
    hemisphere: { sky: '#cfe0ff', ground: '#1a2030', intensity: 1.15 },
    sun: { color: '#e8f0ff', intensity: 1.3 },
    outside: null,
    water: null,
    facings: { block: 'panel', wall: 'panel' },
    border: {
      curb: { height: 0.25, width: 0.6, color: '#3d4654' },
      posts: { shape: 'box', width: 0.2, height: 1.1, spacing: 4, color: '#56606e' },
      rails: { heights: [1.0], thickness: 0.08, color: '#4cc9f0', glow: true },
    },
    decor: [{ kind: 'floorlight', on: ['tiles'], weight: 1, chance: 0.12 }],
    scenery: { kinds: [], density: 0 },
    particles: null,
    stars: true,
    map: { prop: '#56606e', low: '#8f9aab' },
  },
};
