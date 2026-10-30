import { applySymmetry, ellipse, prop, rect, ring } from './layout-tools.js';
import type { TerrainHill } from './terrain.js';
import type { QuestionPool, SurfaceId, World, WorldPoint, WorldProp } from './world.js';

/*
 * The worlds a fresh install starts with. They are ordinary, editable worlds: the store seeds
 * each one once (by ID), and from then on it belongs to the admins like any world they built.
 * Every world here is symmetric, so no spawn point has an advantage, except Kidwells Park, which
 * follows a real park and keeps its spawn points apart instead.
 *
 * Each world (but the prototype court) asks from its own part of the question bank by default.
 */

const quad = <T extends { x: number; z: number; rotation: number }>(items: T[]) => applySymmetry(items, 'quad');
const mirrorX = <T extends { x: number; z: number; rotation: number }>(items: T[]) => applySymmetry(items, 'mirror-x');
const points = (list: [number, number][]): WorldPoint[] => list.map(([x, z]) => ({ x, z }));
const quadPoints = (list: [number, number][]): WorldPoint[] => applySymmetry(points(list).map((p) => ({ ...p, rotation: 0 })), 'quad').map(({ x, z }) => ({ x, z }));

/**
 * A built-in world's own question pool (question-bank IDs from the content seed; a server test
 * checks they exist). Worlds without one ask from the room-wide pool.
 */
const pool = (narrow: Partial<QuestionPool>): QuestionPool => ({ curriculumIds: [], levelIds: [], subjectIds: [], difficulty: [1, 5], ...narrow });

const PROTOTYPE: World = {
  id: 'prototype-court',
  name: 'Prototype court',
  description: 'The Phase 0 square court with five cover blocks.',
  layout: {
    halfWidth: 15,
    halfDepth: 15,
    theme: 'classic',
    floor: 'court',
    scatter: 0,
    regions: [],
    props: [
      prop('block', 0, 0, { width: 3, depth: 3, height: 1.5 }),
      prop('block', -8, 6, { width: 2, depth: 4, height: 1.5 }),
      prop('block', 8, -6, { width: 2, depth: 4, height: 1.5 }),
      prop('block', -6, -9, { width: 4, depth: 1.5, height: 1.5 }),
      prop('block', 6, 9, { width: 4, depth: 1.5, height: 1.5 }),
    ],
    spawnPoints: points([
      [-11, -11],
      [11, 11],
      [-11, 11],
      [11, -11],
    ]),
  },
};

export const PROTOTYPE_WORLD: Readonly<World> = Object.freeze(PROTOTYPE);

const MAPLE_PARK: World = {
  id: 'maple-park',
  name: 'Maple Park',
  description: 'A sunny park: a fountain plaza ringed by low hedges, shady groves, ponds and lamp-lit paths.',
  questions: pool({ curriculumIds: ['in-cbse'] }),
  layout: {
    halfWidth: 42,
    halfDepth: 42,
    theme: 'park',
    floor: 'grass',
    scatter: 0.6,
    regions: [
      ...quad([ellipse('dirt', 28, 24, 9, 6, 20)]),
      rect('cobbles', 0, 0, 84, 4),
      rect('cobbles', 0, 0, 4, 84),
      ...quad([rect('cobbles', 14, 14, 3, 22, 45)]),
      ellipse('cobbles', 0, 0, 20, 20),
    ],
    props: [
      prop('fountain', 0, 0, { width: 5, height: 0.9 }),
      ...quad([prop('bench', 5.6, 5.6, { rotation: 45 })]),
      ...ring('hedge', 16, 12, { startDeg: 11.25, width: 3, skip: (i) => i % 4 === 3 }),
      ...quad([
        prop('tree', 14, 27),
        prop('tree', 21, 34, { scale: 1.15 }),
        prop('tree', 27, 19, { scale: 0.9 }),
        prop('tree', 34, 26),
        prop('tree', 9, 34, { scale: 0.85 }),
        prop('tree', 33, 9, { scale: 1.1 }),
        prop('pond', 22, 9, { width: 6 }),
        prop('rock', 26.5, 13, { scale: 0.8 }),
        prop('rock', 10, 17, { scale: 1.1 }),
        prop('lamp', 3, 17),
        prop('lamp', 3, 24),
        prop('lamp', 17, 3),
        prop('lamp', 24, 3),
        prop('hedge', 36, 17, { rotation: 90, width: 5 }),
        prop('planter', 17, 36, { width: 3 }),
      ]),
    ],
    spawnPoints: [...quadPoints([[36, 36]]), ...points([[0, 37], [0, -37], [37, 0], [-37, 0]])],
  },
};

const SCHOOLYARD: World = {
  id: 'schoolyard',
  name: 'Schoolyard',
  description: 'Break time: a painted court, playgrounds on both sides, a covered walkway and the bike sheds.',
  questions: pool({ levelIds: ['in-cbse-class-10'], subjectIds: ['mathematics'] }),
  layout: {
    halfWidth: 48,
    halfDepth: 32,
    theme: 'schoolyard',
    floor: 'asphalt',
    scatter: 0.3,
    regions: [
      rect('grass', 0, 28.5, 96, 7),
      rect('grass', 0, -28.5, 96, 7),
      rect('tiles', 0, 14, 96, 4),
      rect('court', 0, -2, 30, 17),
      ...mirrorX([ellipse('rubber', 32, -10, 20, 15)]),
    ],
    props: [
      ...quad([prop('bench', 6, 12.2)]),
      prop('wall', 0, 20, { width: 4, depth: 0.5, height: 2, rotation: 90 }),
      ...mirrorX([
        // Bike shed: a U of walls open towards the court.
        prop('wall', 22, 22, { width: 8, depth: 0.5, height: 2 }),
        prop('wall', 18.25, 19, { width: 6, depth: 0.5, height: 2, rotation: 90 }),
        prop('crate', 21, 20.2),
        prop('crate', 22.4, 20.3, { rotation: 20 }),
        // Covered walkway columns.
        prop('pillar', 6, 16.6, { width: 0.8, height: 3 }),
        prop('pillar', 30, 16.6, { width: 0.8, height: 3 }),
        prop('pillar', 42, 16.6, { width: 0.8, height: 3 }),
        prop('planter', 18, -4, { rotation: 90, width: 3 }),
        prop('planter', 18, 4, { rotation: 90, width: 3 }),
        ...ring('tire', 6, 3, { startDeg: 0 }).map((t) => ({ ...t, x: t.x + 32, z: t.z - 10 })),
        prop('wall', 25, -3, { width: 5, depth: 0.5, height: 1.6, rotation: 90 }),
        prop('wall', 41, 6, { width: 6, depth: 0.5, height: 1.6 }),
        prop('wall', 10, -20, { width: 6, depth: 0.5, height: 0.9 }),
        // Cover between neighbouring spawn points, so nobody spawns in someone's line of fire.
        prop('wall', 42, -13, { width: 4, depth: 0.5, height: 1.6 }),
        prop('lamp', 12, 8),
        prop('lamp', 44, -21),
        prop('tree', 6, 28.5),
        prop('tree', 18, 29, { scale: 1.1 }),
        prop('tree', 30, 28.5, { scale: 0.9 }),
        prop('tree', 42, 29),
        prop('tree', 6, -28.5, { scale: 1.1 }),
        prop('tree', 18, -29),
        prop('tree', 30, -28.5),
        prop('tree', 42, -29, { scale: 0.9 }),
      ]),
    ],
    spawnPoints: points([
      [44, 24],
      [-44, 24],
      [44, -24],
      [-44, -24],
      [10, 20],
      [-10, 20],
      [40, -2],
      [-40, -2],
    ]),
  },
};

const SHIPWRECK_COVE: World = {
  id: 'shipwreck-cove',
  name: 'Shipwreck Cove',
  description: 'A wide beach around a wrecked boat: palm groves, rock pools, crate piles and boardwalks.',
  questions: pool({ levelIds: ['gb-gcse-year-11'], subjectIds: ['geography', 'biology'] }),
  layout: {
    halfWidth: 56,
    halfDepth: 36,
    theme: 'beach',
    floor: 'sand',
    scatter: 0.5,
    regions: [...quad([ellipse('dirt', 40, 20, 18, 10, 15)]), ...mirrorX([rect('boards', 20, 0, 3, 72)]), rect('boards', 0, 0, 40, 3)],
    props: [
      prop('boat', 0, 0, { width: 7, depth: 2.6, height: 1.4 }),
      ...mirrorX([prop('boat', 36, 0, { rotation: 90 })]),
      ...quad([
        prop('palm', 10, 26),
        prop('palm', 14, 31, { scale: 1.15 }),
        prop('palm', 29, 28),
        prop('palm', 46, 28, { scale: 0.9 }),
        prop('palm', 50, 14),
        prop('palm', 40, 9, { scale: 1.1 }),
        prop('rock', 26, 13, { width: 2.6, height: 1.5 }),
        prop('rock', 8, 15, { scale: 0.9 }),
        prop('rock', 47, 5),
        prop('crate', 13, 6),
        prop('crate', 14.4, 6.3, { rotation: 15 }),
        prop('crate', 13.7, 7.6, { rotation: 40, scale: 0.8 }),
        prop('barrel', 16, 4.6),
        prop('barrel', 11.6, 4.8),
        prop('sandcastle', 27, 4),
        prop('sandcastle', 6, 30, { scale: 0.8 }),
        prop('pond', 39, 24, { width: 4.5 }),
      ]),
    ],
    spawnPoints: [...quadPoints([[52, 31]]), ...points([[0, 32], [0, -32], [52, 0], [-52, 0]])],
  },
};

const fort = (cx: number, cz: number): WorldProp[] => {
  const wall = (x: number, z: number, rotation = 0) => prop('wall', x, z, { width: 4.5, depth: 0.8, height: 1.8, rotation });
  return [
    wall(cx - 3.75, cz + 6),
    wall(cx + 3.75, cz + 6),
    wall(cx - 3.75, cz - 6),
    wall(cx + 3.75, cz - 6),
    wall(cx + 6, cz - 3.75, 90),
    wall(cx + 6, cz + 3.75, 90),
    wall(cx - 6, cz - 3.75, 90),
    wall(cx - 6, cz + 3.75, 90),
    prop('snowman', cx, cz),
  ];
};

const FROST_FORT: World = {
  id: 'frost-fort',
  name: 'Frost Fort',
  description: 'Four snow forts guard a frozen rink. Pine woods in between, snowmen on watch.',
  questions: pool({ levelIds: ['gb-gcse-year-11'], subjectIds: ['chemistry', 'physics'] }),
  layout: {
    halfWidth: 50,
    halfDepth: 50,
    theme: 'snow',
    floor: 'snow',
    scatter: 0.6,
    regions: [ellipse('ice', 0, 0, 24, 24), ...quad([ellipse('ice', 30, 30, 10, 10), ellipse('ice', 40, 10, 8, 5, 30)])],
    props: [
      ...ring('block', 8, 15, { startDeg: 22.5, width: 4, depth: 1, height: 0.8 }),
      ...quad([
        ...fort(30, 30),
        prop('pine', 8, 28),
        prop('pine', 12, 40, { scale: 1.2 }),
        prop('pine', 4, 36, { scale: 0.85 }),
        prop('pine', 28, 8),
        prop('pine', 40, 12, { scale: 1.2 }),
        prop('pine', 36, 4, { scale: 0.85 }),
        prop('pine', 45, 45, { scale: 1.1 }),
        prop('pine', 20, 46),
        prop('rock', 20, 6),
        prop('rock', 6, 20),
        prop('snowman', 16, 26, { scale: 0.8 }),
      ]),
    ],
    spawnPoints: [...quadPoints([[18, 18]]), ...points([[0, 46], [0, -46], [46, 0], [-46, 0]])],
  },
};

const GRAND_LIBRARY: World = {
  id: 'grand-library',
  name: 'Grand Library',
  description: 'Hush! Long aisles of bookshelves meet in a tiled reading room under tall pillars.',
  questions: pool({ levelIds: ['in-cbse-class-10'], subjectIds: ['science', 'social-science'] }),
  layout: {
    halfWidth: 36,
    halfDepth: 48,
    theme: 'library',
    floor: 'boards',
    scatter: 0.25,
    regions: [rect('carpet', 0, 0, 8, 96), rect('carpet', 0, 0, 72, 6), rect('tiles', 0, 0, 22, 17)],
    props: [
      ...quad([
        ...[12, 18, 24, 30, 36, 42].flatMap((z, row) => [
          prop('bookshelf', row % 2 === 0 ? 13.5 : 14.5, z, { width: 9 }),
          prop('bookshelf', row % 2 === 0 ? 28 : 29, z, { width: row % 3 === 2 ? 5 : 8 }),
        ]),
        prop('desk', 4.5, 4),
        prop('pillar', 9, 7, { width: 1.4, height: 3.5 }),
        prop('pillar', 5.2, 15, { width: 1.2, height: 3.5 }),
        prop('pillar', 5.2, 27, { width: 1.2, height: 3.5 }),
        prop('pillar', 5.2, 39, { width: 1.2, height: 3.5 }),
        prop('planter', 33.5, 4.5, { rotation: 90, width: 2.4 }),
        prop('crate', 21.5, 45),
      ]),
    ],
    spawnPoints: [...quadPoints([[33, 45]]), ...points([[0, 44], [0, -44], [33, 0], [-33, 0]])],
  },
};

const ORBITAL_STATION: World = {
  id: 'orbital-station',
  name: 'Orbital Station',
  description: 'A huge station deck: a reactor core, two rings of bulkheads and four cargo bays.',
  questions: pool({ levelIds: ['gb-gcse-year-11'], subjectIds: ['physics', 'mathematics'] }),
  layout: {
    halfWidth: 70,
    halfDepth: 70,
    theme: 'space',
    floor: 'metal',
    scatter: 0.4,
    regions: [
      ellipse('tiles', 0, 0, 66, 66),
      ellipse('metal', 0, 0, 50, 50),
      rect('tiles', 0, 0, 140, 6),
      rect('tiles', 0, 0, 6, 140),
      ellipse('tiles', 0, 0, 18, 18),
      ...quad([rect('tiles', 48, 48, 22, 22, 45)]),
    ],
    props: [
      prop('pod', 0, 0, { width: 4, height: 1.6 }),
      ...ring('console', 4, 6, { startDeg: 45 }),
      ...ring('wall', 16, 31, { width: 9, depth: 0.7, height: 2.2, skip: (i) => i % 4 === 0 }),
      ...ring('wall', 8, 21, { startDeg: 22.5, width: 9, depth: 0.7, height: 2.2 }),
      ...quad([
        prop('pod', 43, 53),
        prop('pod', 53, 43),
        prop('crate', 48, 48, { scale: 1.4 }),
        prop('crate', 49.8, 47.6, { rotation: 30 }),
        prop('crate', 47.2, 49.9, { rotation: 60, scale: 0.9 }),
        prop('console', 40, 40, { rotation: 45 }),
        prop('pillar', 4.5, 40),
        prop('pillar', 4.5, 56),
        prop('pillar', 40, 4.5),
        prop('pillar', 56, 4.5),
        prop('block', 60, 20, { width: 3, depth: 3 }),
        prop('block', 20, 60, { width: 3, depth: 3 }),
        prop('block', 36, 26, { width: 4, depth: 1.5, height: 1, rotation: 35 }),
        prop('block', 26, 36, { width: 4, depth: 1.5, height: 1, rotation: 55 }),
      ]),
    ],
    spawnPoints: [...quadPoints([[63, 63]]), ...points([[0, 64], [0, -64], [64, 0], [-64, 0]])],
  },
};

const hill = (x: number, z: number, width: number, depth: number, height: number, options: { rotation?: number; plateau?: number } = {}): TerrainHill => ({
  x,
  z,
  width,
  depth,
  rotation: options.rotation ?? 0,
  height,
  plateau: options.plateau ?? 0,
});

const ROLLING_HILLS: World = {
  id: 'rolling-hills',
  name: 'Rolling Hills',
  description: 'Open meadow over rolling ground: a flat-topped hill in the middle, ridges to duck behind and hollows to hide in.',
  questions: pool({ levelIds: ['in-cbse-class-10'], subjectIds: ['mathematics', 'science'] }),
  layout: {
    halfWidth: 46,
    halfDepth: 46,
    theme: 'park',
    floor: 'grass',
    scatter: 0.55,
    terrain: { relief: 2.2, scale: 24, seed: 4, symmetry: 'quad' },
    hills: [
      hill(0, 0, 26, 26, 3.2, { plateau: 0.4 }),
      ...quad([
        hill(20, 7, 22, 9, 1.7, { rotation: 70, plateau: 0.2 }),
        hill(7, 20, 22, 9, 1.7, { rotation: 20, plateau: 0.2 }),
        hill(37, 37, 16, 16, -1.8, { plateau: 0.45 }),
        hill(28, 20, 15, 15, 2.2, { plateau: 0.3 }),
      ]),
    ],
    regions: [
      ellipse('dirt', 0, 0, 16, 16),
      rect('cobbles', 0, 0, 3, 92),
      rect('cobbles', 0, 0, 92, 3),
      ...quad([ellipse('dirt', 37, 37, 9, 9)]),
    ],
    props: [
      prop('rock', 0, 0, { scale: 1.2 }),
      ...quad([
        prop('tree', 14, 32),
        prop('tree', 32, 14, { scale: 1.1 }),
        prop('tree', 21, 39, { scale: 0.9 }),
        prop('tree', 39, 21),
        prop('tree', 42, 8, { scale: 1.15 }),
        prop('tree', 8, 42, { scale: 0.95 }),
        prop('rock', 26, 29, { scale: 0.9 }),
        prop('rock', 12, 12, { scale: 0.8 }),
        prop('hedge', 30, 4, { rotation: 90, width: 4 }),
        prop('hedge', 4, 30, { width: 4 }),
        prop('bench', 7, 3.6),
        prop('lamp', 3, 12),
      ]),
    ],
    spawnPoints: [...quadPoints([[38, 38]]), ...points([[0, 40], [0, -40], [40, 0], [-40, 0]])],
  },
};

/** A straight strip of floor from one point to another (a footpath), overlapping the next one at the joints. */
const path = (x1: number, z1: number, x2: number, z2: number, width = 2.4, surface: SurfaceId = 'asphalt') =>
  rect(
    surface,
    Math.round(((x1 + x2) / 2) * 100) / 100,
    Math.round(((z1 + z2) / 2) * 100) / 100,
    Math.round((Math.hypot(x2 - x1, z2 - z1) + width) * 100) / 100,
    width,
    Math.round((Math.atan2(z1 - z2, x2 - x1) * 180) / Math.PI),
  );

/*
 * Kidwells Park, Maidenhead (UK), traced from an aerial photo at about half scale: north is +z,
 * east is −x (the builder's plan shows it the right way round). Unlike the other built-in worlds it
 * follows the real park, so it is not symmetric; its spawn points are kept out of each other's range.
 */
const KIDWELLS_PARK: World = {
  id: 'kidwells-park',
  name: 'Kidwells Park',
  description:
    "Maidenhead's town park: the WWI memorial garden, a long flower border, the waterfall and brook, tennis courts, a skate park and big old trees, with Bad Godesberg Way along the south-east.",
  questions: pool({ curriculumIds: ['gb-gcse'] }),
  layout: {
    halfWidth: 64,
    halfDepth: 44,
    theme: 'park',
    floor: 'grass',
    scatter: 0.5,
    // The old gravel ridge across the middle, and a dip where the brook runs.
    terrain: { relief: 0.6, scale: 30, seed: 11, symmetry: 'none' },
    hills: [hill(-6, 1, 52, 12, 1, { rotation: 5, plateau: 0.3 }), hill(-28.5, 13, 12, 9, -0.8, { rotation: 30, plateau: 0.3 })],
    regions: [
      ...[
        [62.8, 22, 44.2, 16.5], // in from the Marlow Road car park
        [44.2, 16.5, 13.8, 20],
        [13.8, 20, -6.4, 21.6],
        [-6.4, 21.6, -24.3, 21.2],
        [-24.3, 21.2, -41.6, 18.1],
        [-24.3, 21.2, -38.4, 33.5],
        [-38.4, 33.5, -51, 41], // up to the courts
        [14.7, 42.8, 13.8, 20], // the north gate
        [13.8, 20, 7.7, -20.3],
        [7.7, -20.3, 4.6, -42.8],
        [44.2, 16.5, 42, 8], // round the memorial garden
        [42, 8, 28.2, -4.9],
        [28.2, -4.9, 7.7, -20.3],
        [7.7, -20.3, -11.5, -31.8],
        [-11.5, -31.8, -44.8, -8.4], // along the A4
        [-44.8, -8.4, -62.9, 3.3],
        [-40.5, 31, -41.6, 18.1], // the east walk
        [-41.6, 18.1, -44.2, 5.3],
        [-44.2, 5.3, -44.8, -8.4],
        [-11.5, -31.8, 3.2, -38.5],
        [3.2, -38.5, 30, -42.5],
      ].map(([x1, z1, x2, z2]) => path(x1!, z1!, x2!, z2!)),
      // WWI memorial garden: a paved octagon among shrub beds.
      ellipse('cobbles', 31, 9.5, 8, 8),
      ellipse('dirt', 29.4, 15.9, 9, 3.2, 8),
      ellipse('dirt', 37.8, 10.5, 3, 8),
      ellipse('dirt', 32.5, 3.6, 6, 2.6, -30),
      // The long flower border beside the north–south path.
      path(16.3, 17.5, 12.2, -17.7, 2.6, 'dirt'),
      ellipse('dirt', -12.2, -25.4, 13, 5.5, 5),
      // Rockery round the waterfall and brook.
      ellipse('dirt', -35, 24.5, 10, 6, -20),
      ellipse('dirt', -28.5, 13.5, 9, 6, 30),
      ellipse('rubber', -58, 12, 9, 12, 10),
      rect('tiles', -55, 0, 14, 10),
      rect('court', -58.25, 34.25, 10.5, 18.5),
    ],
    props: [
      // Big old trees: the copper beeches along the back gardens, the planes, the lawn trees.
      prop('tree', 57, 32.8, { scale: 1.4 }),
      prop('tree', 44.8, 27.7, { scale: 1.3 }),
      prop('tree', 36.5, 23.6, { scale: 1.2 }),
      prop('tree', 28.2, 26.4, { scale: 1.4 }),
      prop('tree', 19.2, 29, { scale: 1.3 }),
      prop('tree', 8.3, 31.6, { scale: 1.2 }),
      prop('tree', -2, 35, { scale: 1.1 }),
      prop('tree', -16, 36),
      prop('tree', -28.8, 38, { scale: 1.1 }),
      prop('tree', -8.3, 16.4, { scale: 1.3 }),
      prop('tree', -13, 15.6),
      prop('tree', -36.5, 0.2, { scale: 2 }),
      prop('tree', -33.9, 8.4, { scale: 1.1 }),
      prop('tree', -3.8, -12, { scale: 1.3 }),
      prop('tree', -3.2, -17.6, { scale: 0.9 }),
      prop('tree', -16.6, -14.5, { scale: 1.2 }),
      prop('tree', -18.6, -6.8, { scale: 1.1 }),
      prop('tree', -29.4, -13.9, { scale: 0.8 }),
      prop('tree', 51.2, 4, { scale: 1.3 }),
      prop('tree', 47.4, -10.7, { scale: 1.6 }),
      prop('tree', 52.5, 11.1),
      prop('tree', 60.2, -1.1, { scale: 1.2 }),
      prop('tree', 26.2, -35.6, { scale: 1.2 }),
      prop('tree', 9, -36.9, { scale: 1.4 }),
      prop('tree', 15.4, -33.4),
      prop('tree', 44.8, -29.9, { scale: 1.3 }),
      prop('pine', 26.9, -15.8, { scale: 0.7 }),
      prop('pine', 35.8, -24.1, { scale: 0.6 }),
      prop('tree', -48.6, 23.2),
      prop('tree', -49.9, 16.8, { scale: 0.9 }),
      prop('tree', -51.2, 8.4),
      // The boundary along Bad Godesberg Way (A4): a row of trees with hedges between, grass verge beyond.
      prop('tree', -16.7, -36.6, { scale: 1.1 }),
      prop('tree', -27.5, -29.4, { scale: 1.2 }),
      prop('tree', -38.4, -22.1),
      prop('tree', -49.3, -14.9, { scale: 1.2 }),
      prop('tree', -58.5, -8.7),
      prop('hedge', -22.6, -33.8, { width: 7, height: 1.4, rotation: 33.6 }),
      prop('hedge', -33.5, -26.6, { width: 7, height: 1.4, rotation: 33.6 }),
      prop('hedge', -44.4, -19.4, { width: 7, height: 1.4, rotation: 33.6 }),
      // WWI memorial garden.
      prop('pillar', 31, 9.5, { width: 1, height: 2.6 }),
      prop('bench', 34.4, 9.5, { rotation: 90 }),
      prop('bench', 27.6, 9.5, { rotation: 90 }),
      prop('hedge', 29.4, 15.9, { width: 6, depth: 1.4, height: 1.2, rotation: 8 }),
      prop('hedge', 37.8, 10.5, { width: 5, depth: 1.4, height: 1.2, rotation: 90 }),
      prop('hedge', 32.5, 3.6, { width: 4, depth: 1.2, rotation: -30 }),
      // The flower border, with gaps to cross it.
      ...[
        [15.9, 14],
        [15.1, 6.9],
        [14.25, -0.1],
        [13.4, -7.1],
        [12.6, -14.2],
      ].map(([x, z]) => prop('hedge', x!, z!, { width: 5, rotation: 96.6 })),
      // Flower bed island by the south path.
      prop('tree', -11.5, -24.6, { scale: 0.9 }),
      prop('planter', -7.6, -25.8),
      prop('planter', -16.6, -25.2),
      // Waterfall and brook among the rockery.
      prop('rock', -32.4, 16.8, { width: 2.4, height: 1.9 }),
      prop('rock', -30.9, 18.3, { scale: 0.8 }),
      prop('pond', -29.8, 14.6, { width: 4.5 }),
      prop('pond', -27, 12, { width: 2.6 }),
      prop('pond', -25.2, 10, { width: 2 }),
      prop('rock', -27.4, 15.4, { scale: 0.6 }),
      prop('rock', -33.3, 24.5),
      prop('rock', -38.4, 26.2, { scale: 0.8 }),
      prop('planter', -35.8, 23, { rotation: -20 }),
      prop('hedge', -23, 15.6, { width: 2.4 }),
      prop('hedge', -19.8, 15.6, { width: 2.4 }),
      // Benches and lamps along the paths.
      prop('bench', 20.5, 18),
      prop('bench', -1, 19.8),
      prop('bench', 21.6, -8.4, { rotation: 37 }),
      prop('bench', -26, -21.5, { rotation: -35 }),
      prop('bench', -54, 17.5),
      prop('lamp', 40.8, 18.6),
      prop('lamp', 12, 22.2),
      prop('lamp', -22, 23.4),
      prop('lamp', 9.8, -18.6),
      prop('lamp', -42.6, -5),
      // Play area.
      ...ring('tire', 5, 2.6).map((t) => ({ ...t, x: t.x - 58, z: t.z + 12 })),
      // Matrix Skate Park: ledges, a funbox and a quarter pipe.
      prop('block', -51.5, 2.5, { width: 4, depth: 1.2, height: 0.6 }),
      prop('block', -56.5, -1.5, { width: 3, depth: 3, height: 1, rotation: 45 }),
      prop('block', -61, 0, { width: 8, depth: 1.4, height: 1.4, rotation: 90 }),
      // Tennis and netball courts, fenced, with a gate.
      prop('wall', -52.6, 39.75, { width: 7.5, depth: 0.3, height: 2.4, rotation: 90 }),
      prop('wall', -52.6, 28.6, { width: 7.2, depth: 0.3, height: 2.4, rotation: 90 }),
      prop('wall', -58.3, 25, { width: 11.4, depth: 0.3, height: 2.4 }),
    ],
    spawnPoints: points([
      [54.4, 16.2],
      [0, 27.7],
      [-48.6, 36],
      [-53, 6],
      [-28.8, -24.1],
      [0, -31.8],
      [33.3, -29.9],
      [23, 2.8],
    ]),
  },
};

/** Every built-in world, in the order the admin panel lists them. */
export const BUILTIN_WORLDS: readonly World[] = Object.freeze([
  MAPLE_PARK,
  ROLLING_HILLS,
  KIDWELLS_PARK,
  SCHOOLYARD,
  SHIPWRECK_COVE,
  FROST_FORT,
  GRAND_LIBRARY,
  ORBITAL_STATION,
  PROTOTYPE_WORLD,
]);

/** The world a fresh install's rooms play. */
export const DEFAULT_WORLD_ID = MAPLE_PARK.id;
