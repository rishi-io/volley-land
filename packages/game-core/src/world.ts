import type { TerrainHill, WorldTerrain } from './terrain.js';

/*
 * The authored shape of a world: what the world builder edits, what is stored (one record per
 * world) and what the room.join ack carries. Both server and client turn a layout into the same
 * collision Arena with `arenaFromLayout`, ground heights included (terrain.ts); everything else
 * here (theme, floor, regions, decoration density) is presentation and never affects the simulation.
 */

/** How big a world may be and how much it may hold (contracts' WorldLayoutSchema enforces the same). */
export const WORLD_LIMITS = Object.freeze({
  maxHalfExtent: 100,
  minHalfExtent: 5,
  maxProps: 400,
  maxRegions: 64,
  minSpawnPoints: 2,
  maxSpawnPoints: 16,
  maxPropSize: 60,
  maxPropHeight: 12,
  maxRelief: 12,
  minTerrainScale: 8,
  maxTerrainScale: 120,
  maxHills: 64,
  minHillSize: 2,
  maxHillSize: 200,
  maxHillHeight: 15,
});

/** A scene style: sky, light, fog, border, scenery and ambient particles. Presentation only. */
export const THEMES = ['classic', 'park', 'schoolyard', 'beach', 'snow', 'library', 'space'] as const;
export type ThemeId = (typeof THEMES)[number];

/** Ground materials for the floor and painted regions. Presentation only: every surface plays the same. */
export const SURFACES = [
  'court',
  'grass',
  'dirt',
  'sand',
  'cobbles',
  'boards',
  'tiles',
  'carpet',
  'snow',
  'ice',
  'asphalt',
  'rubber',
  'metal',
] as const;
export type SurfaceId = (typeof SURFACES)[number];

/** Collision footprint of a prop: an oriented box, or a circle (width is the diameter). */
export type PropShape = 'box' | 'circle';

/** Props players fight around. Every prop is solid: it blocks movement, and throws unless it is low. */
export const PROP_KINDS = [
  'block',
  'wall',
  'crate',
  'barrel',
  'rock',
  'tree',
  'pine',
  'palm',
  'hedge',
  'planter',
  'bench',
  'pillar',
  'lamp',
  'fountain',
  'pond',
  'bookshelf',
  'desk',
  'snowman',
  'cactus',
  'sandcastle',
  'boat',
  'tire',
  'pod',
  'console',
  // The past: castles and the village round them.
  'tower',
  'rampart',
  'gatehouse',
  'well',
  'cart',
  'haybale',
  'noticeboard',
  // The present: the street.
  'car',
  'bus',
  'container',
  'vending',
  'dumpster',
  'barrier',
  'billboard',
  // The future: sci-fi outposts.
  'reactor',
  'forcefield',
  'crystal',
  'dish',
  'rover',
  'pylon',
  'hologram',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export interface PropInfo {
  name: string;
  shape: PropShape;
  /** Size a new prop of this kind starts at, in metres (circles: width is the diameter). */
  size: { width: number; depth: number; height: number };
  /** Whether the builder offers resizing each axis on its own (boxes), or one scale (models). */
  stretch: boolean;
}

/** The prop catalogue. Shapes and sizes are shared with collision; looks live in the client. */
export const PROPS: Readonly<Record<PropKind, PropInfo>> = Object.freeze({
  block: { name: 'Block', shape: 'box', size: { width: 2, depth: 2, height: 1.5 }, stretch: true },
  wall: { name: 'Wall', shape: 'box', size: { width: 6, depth: 0.6, height: 2 }, stretch: true },
  crate: { name: 'Crate', shape: 'box', size: { width: 1.2, depth: 1.2, height: 1.2 }, stretch: true },
  barrel: { name: 'Barrel', shape: 'circle', size: { width: 1, depth: 1, height: 1.2 }, stretch: false },
  rock: { name: 'Rock', shape: 'circle', size: { width: 2, depth: 2, height: 1.3 }, stretch: false },
  tree: { name: 'Tree', shape: 'circle', size: { width: 2.6, depth: 2.6, height: 4 }, stretch: false },
  pine: { name: 'Pine', shape: 'circle', size: { width: 2.4, depth: 2.4, height: 4.5 }, stretch: false },
  palm: { name: 'Palm', shape: 'circle', size: { width: 1.2, depth: 1.2, height: 4.5 }, stretch: false },
  hedge: { name: 'Hedge', shape: 'box', size: { width: 3, depth: 1, height: 0.9 }, stretch: true },
  planter: { name: 'Planter', shape: 'box', size: { width: 2, depth: 1, height: 0.7 }, stretch: true },
  bench: { name: 'Bench', shape: 'box', size: { width: 2, depth: 0.7, height: 0.8 }, stretch: true },
  pillar: { name: 'Pillar', shape: 'circle', size: { width: 1.2, depth: 1.2, height: 3 }, stretch: false },
  lamp: { name: 'Lamp post', shape: 'circle', size: { width: 0.4, depth: 0.4, height: 3.5 }, stretch: false },
  fountain: { name: 'Fountain', shape: 'circle', size: { width: 4, depth: 4, height: 0.9 }, stretch: false },
  pond: { name: 'Pond', shape: 'circle', size: { width: 5, depth: 5, height: 0.3 }, stretch: false },
  bookshelf: { name: 'Bookshelf', shape: 'box', size: { width: 3, depth: 0.8, height: 2.4 }, stretch: true },
  desk: { name: 'Desk', shape: 'box', size: { width: 1.8, depth: 1, height: 0.8 }, stretch: true },
  snowman: { name: 'Snowman', shape: 'circle', size: { width: 1.4, depth: 1.4, height: 1.9 }, stretch: false },
  cactus: { name: 'Cactus', shape: 'circle', size: { width: 1, depth: 1, height: 2.2 }, stretch: false },
  sandcastle: { name: 'Sandcastle', shape: 'circle', size: { width: 1.8, depth: 1.8, height: 1.1 }, stretch: false },
  boat: { name: 'Boat', shape: 'box', size: { width: 4.5, depth: 1.8, height: 1.2 }, stretch: true },
  tire: { name: 'Tyre', shape: 'circle', size: { width: 1.2, depth: 1.2, height: 0.45 }, stretch: false },
  pod: { name: 'Pod', shape: 'circle', size: { width: 2.2, depth: 2.2, height: 1.6 }, stretch: false },
  console: { name: 'Console', shape: 'box', size: { width: 2, depth: 1, height: 0.9 }, stretch: true },
  tower: { name: 'Castle tower', shape: 'circle', size: { width: 3, depth: 3, height: 6 }, stretch: false },
  rampart: { name: 'Rampart', shape: 'box', size: { width: 6, depth: 1.2, height: 3 }, stretch: true },
  gatehouse: { name: 'Gatehouse', shape: 'box', size: { width: 6, depth: 2.4, height: 4.5 }, stretch: false },
  well: { name: 'Well', shape: 'circle', size: { width: 1.8, depth: 1.8, height: 2.6 }, stretch: false },
  cart: { name: 'Hay cart', shape: 'box', size: { width: 2.8, depth: 1.5, height: 1.7 }, stretch: false },
  haybale: { name: 'Hay bale', shape: 'box', size: { width: 1.6, depth: 1.1, height: 1 }, stretch: true },
  noticeboard: { name: 'Notice board', shape: 'box', size: { width: 2.4, depth: 0.4, height: 2.4 }, stretch: true },
  car: { name: 'Car', shape: 'box', size: { width: 4.2, depth: 1.9, height: 1.5 }, stretch: false },
  bus: { name: 'Bus', shape: 'box', size: { width: 10, depth: 2.6, height: 3.2 }, stretch: false },
  container: { name: 'Shipping container', shape: 'box', size: { width: 6, depth: 2.4, height: 2.6 }, stretch: true },
  vending: { name: 'Vending machine', shape: 'box', size: { width: 1.1, depth: 0.9, height: 1.9 }, stretch: false },
  dumpster: { name: 'Dumpster', shape: 'box', size: { width: 2, depth: 1.3, height: 1.4 }, stretch: false },
  barrier: { name: 'Road barrier', shape: 'box', size: { width: 3, depth: 0.6, height: 0.9 }, stretch: true },
  billboard: { name: 'LED billboard', shape: 'box', size: { width: 5, depth: 0.6, height: 3.6 }, stretch: true },
  reactor: { name: 'Reactor', shape: 'circle', size: { width: 2.6, depth: 2.6, height: 3 }, stretch: false },
  forcefield: { name: 'Forcefield', shape: 'box', size: { width: 4, depth: 0.5, height: 2.2 }, stretch: true },
  crystal: { name: 'Energy crystal', shape: 'circle', size: { width: 1.8, depth: 1.8, height: 2.4 }, stretch: false },
  dish: { name: 'Satellite dish', shape: 'circle', size: { width: 2.4, depth: 2.4, height: 3.2 }, stretch: false },
  rover: { name: 'Rover', shape: 'box', size: { width: 3.2, depth: 2, height: 1.8 }, stretch: false },
  pylon: { name: 'Pylon', shape: 'circle', size: { width: 0.9, depth: 0.9, height: 4 }, stretch: false },
  hologram: { name: 'Hologram sign', shape: 'box', size: { width: 4, depth: 0.6, height: 3.2 }, stretch: true },
});

/** A placed prop: centre on the floor, size, and turn about the vertical axis. */
export interface WorldProp {
  kind: PropKind;
  x: number;
  z: number;
  width: number;
  /** Ignored for circle props (the footprint is a circle of diameter `width`). */
  depth: number;
  height: number;
  /** Degrees, counter-clockwise seen from above (three.js rotation.y). */
  rotation: number;
}

/** A painted patch of floor: a path, a rug, a rink. Drawn in list order over the floor. */
export interface FloorRegion {
  surface: SurfaceId;
  shape: 'rect' | 'ellipse';
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: number;
}

export interface WorldPoint {
  x: number;
  z: number;
}

export interface WorldLayout {
  /** Playable floor spans [-halfWidth, halfWidth] × [-halfDepth, halfDepth] on X/Z. */
  halfWidth: number;
  halfDepth: number;
  theme: ThemeId;
  floor: SurfaceId;
  /** How thickly the theme's small decorations (grass tufts, shells, snow lumps) are scattered, 0–1. */
  scatter: number;
  regions: FloorRegion[];
  props: WorldProp[];
  spawnPoints: WorldPoint[];
  /** Rolling ground; absent means flat (worlds made before terrain have none). */
  terrain?: WorldTerrain;
  /** Hills, hollows and ridges on top of the rolling ground; absent means none. */
  hills?: TerrainHill[];
}

/**
 * Which part of the question bank a match asks from, by question-bank IDs. Empty lists mean
 * "all"; a question must match every list that is not empty. Mirrors contracts' QuestionPoolSchema.
 */
export interface QuestionPool {
  curriculumIds: string[];
  levelIds: string[];
  subjectIds: string[];
  /** [min, max], 1–5. */
  difficulty: [number, number];
}

/** A named world that can be offered to rooms. */
export interface World {
  /** Stable slug, e.g. "maple-park"; the key a room's settings refer to. */
  id: string;
  name: string;
  description: string;
  layout: WorldLayout;
  /** The questions asked in this world; absent means the room-wide pool. Never sent to game clients. */
  questions?: QuestionPool;
}

export interface ThemeInfo {
  name: string;
  /** Floor a new world in this theme starts with. */
  floor: SurfaceId;
  /** Props the palette lists first and the generator places, with relative weights. */
  props: Partial<Record<PropKind, number>>;
  /** Surfaces the generator paints paths and patches with. */
  paths: SurfaceId;
  patches: SurfaceId[];
}

export const THEME_INFO: Readonly<Record<ThemeId, ThemeInfo>> = Object.freeze({
  classic: { name: 'Classic court', floor: 'court', props: { block: 5, wall: 2, pillar: 1 }, paths: 'tiles', patches: ['tiles'] },
  park: {
    name: 'Park',
    floor: 'grass',
    props: { tree: 6, hedge: 4, rock: 2, bench: 2, planter: 1, lamp: 1, pond: 1 },
    paths: 'cobbles',
    patches: ['dirt', 'cobbles'],
  },
  schoolyard: {
    name: 'Schoolyard',
    floor: 'asphalt',
    props: { wall: 3, planter: 3, bench: 2, tire: 2, tree: 2, pillar: 1, crate: 1, lamp: 1 },
    paths: 'tiles',
    patches: ['rubber', 'grass'],
  },
  beach: {
    name: 'Beach',
    floor: 'sand',
    props: { palm: 5, rock: 3, crate: 2, barrel: 2, sandcastle: 2, boat: 1, pond: 1 },
    paths: 'boards',
    patches: ['dirt'],
  },
  snow: {
    name: 'Snowfield',
    floor: 'snow',
    props: { pine: 6, rock: 2, snowman: 2, block: 2, wall: 1 },
    paths: 'ice',
    patches: ['ice'],
  },
  library: {
    name: 'Library',
    floor: 'boards',
    props: { bookshelf: 6, desk: 3, pillar: 2, planter: 1, crate: 1 },
    paths: 'carpet',
    patches: ['carpet', 'tiles'],
  },
  space: {
    name: 'Space station',
    floor: 'metal',
    props: { pod: 3, console: 3, crate: 2, wall: 2, pillar: 2, block: 1 },
    paths: 'tiles',
    patches: ['tiles'],
  },
});

/** Half extents on X and Z of the axis-aligned box around a prop. */
export function propExtent(prop: Pick<WorldProp, 'kind' | 'width' | 'depth' | 'rotation'>): { x: number; z: number } {
  if (PROPS[prop.kind].shape === 'circle') return { x: prop.width / 2, z: prop.width / 2 };
  const angle = (prop.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return { x: (prop.width / 2) * c + (prop.depth / 2) * s, z: (prop.width / 2) * s + (prop.depth / 2) * c };
}

/** A new prop of a kind at its catalogue size. */
export function newProp(kind: PropKind, x = 0, z = 0, rotation = 0): WorldProp {
  const { width, depth, height } = PROPS[kind].size;
  return { kind, x, z, width, depth: PROPS[kind].shape === 'circle' ? width : depth, height, rotation };
}
