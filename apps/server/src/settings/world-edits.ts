import { FloorRegionSchema, PropKindSchema, SurfaceIdSchema, SymmetrySchema, TerrainHillSchema, ThemeIdSchema, WORLD_LIMITS, WorldPointSchema, WorldTerrainSchema } from '@volleyland/contracts';
import {
  DEFAULT_TERRAIN,
  type LayoutItemRef,
  type WorldLayout,
  deleteItems,
  duplicateItems,
  generateLayout,
  mirrorItems,
  moveItems,
  newHill,
  prop,
  reorderRegion,
  ring,
  rotateItems,
  updateItem,
} from '@volleyland/game-core';
import { z } from 'zod';
import { OperationError } from '../operations/operation.js';

/*
 * The world builder's actions as data, so an MCP client can build and edit worlds the way the
 * builder does. Each edit runs the same game-core function the builder calls; the result is
 * validated by WorldSchema when it is saved.
 */

const NEW_HILL = newHill();
const metres = (what: string) => z.number().describe(`${what}, in metres`);
const degrees = z.number().describe('Degrees, counter-clockwise seen from above');
const size = { min: WORLD_LIMITS.minHalfExtent * 2, max: WORLD_LIMITS.maxHalfExtent * 2 };

export const ItemRefSchema = z
  .strictObject({ kind: z.enum(['prop', 'region', 'spawn', 'hill']), index: z.int().nonnegative().describe('Position in that list (props, regions, spawnPoints or hills), from 0') })
  .describe('One item in the layout');
const items = z.array(ItemRefSchema).min(1).max(WORLD_LIMITS.maxProps);

export const GenerateOptionsSchema = z.strictObject({
  theme: ThemeIdSchema,
  width: z.number().min(size.min).max(size.max).describe('Floor width (x), in metres'),
  depth: z.number().min(size.min).max(size.max).describe('Floor depth (z), in metres'),
  density: z.number().min(0).max(1).default(0.55).describe('How much cover: 0 is an open field, 1 is packed'),
  symmetry: SymmetrySchema.default('quad').describe('Mirror the layout for fairness: left/right, front/back or four-way'),
  spawns: z.int().min(WORLD_LIMITS.minSpawnPoints).max(WORLD_LIMITS.maxSpawnPoints).default(4).describe('Spawn points round the edge (rounded to suit the symmetry)'),
  seed: z.int().nonnegative().default(1).describe('The same options and seed always give the same layout; change it for a different one'),
  relief: z.number().min(0).max(1).default(0).describe('How hilly: 0 is flat ground, 1 rolling ground with hills and hollows (mirrored like the props)'),
});

const sizing = {
  scale: z.number().positive().max(10).optional().describe('Multiplies the catalogue size'),
  width: z.number().positive().optional().describe('Width in metres (round props: the diameter)'),
  depth: z.number().positive().optional().describe('Depth in metres (ignored for round props)'),
  height: z.number().positive().optional().describe('Height in metres'),
};

export const WorldEditSchema = z.discriminatedUnion('op', [
  z
    .strictObject({ op: z.literal('add_prop'), kind: PropKindSchema, x: metres('Centre x'), z: metres('Centre z'), rotation: degrees.optional(), ...sizing })
    .describe('Place a prop at its catalogue size (adjusted by scale or explicit sizes)'),
  z
    .strictObject({
      op: z.literal('add_ring'),
      kind: PropKindSchema,
      count: z.int().min(1).max(64),
      radius: z.number().positive().describe('Ring radius in metres'),
      x: metres('Ring centre x').default(0),
      z: metres('Ring centre z').default(0),
      startDeg: z.number().optional().describe('Where the first prop sits, from +x towards +z'),
      rotation: degrees.optional().describe('Extra turn for every prop (they already lie along the ring)'),
      ...sizing,
    })
    .describe('Place props evenly round a circle, each turned to lie along it (a ring of walls or hedges)'),
  FloorRegionSchema.extend({ op: z.literal('add_region'), rotation: degrees.default(0) }).describe('Paint a patch of floor (path, rug, rink); later patches draw on top'),
  WorldPointSchema.extend({ op: z.literal('add_spawn') }).describe('Add a spawn point'),
  TerrainHillSchema.extend({
    op: z.literal('add_hill'),
    // Defaults are the builder's new hill (game-core newHill), so both start from the same mound.
    width: TerrainHillSchema.shape.width.default(NEW_HILL.width),
    depth: TerrainHillSchema.shape.depth.default(NEW_HILL.depth),
    rotation: degrees.default(NEW_HILL.rotation),
    plateau: TerrainHillSchema.shape.plateau.default(NEW_HILL.plateau),
  }).describe('Raise a hill (height > 0) or sink a hollow (height < 0): an oval mound, turned like props. Hills hide players and stop throws; keep them gentle enough to climb (steepest ≈ 1.5 × height ÷ the sloping rim)'),
  z
    .strictObject({
      op: z.literal('update'),
      item: ItemRefSchema,
      set: z
        .strictObject({
          kind: PropKindSchema.optional(),
          surface: SurfaceIdSchema.optional(),
          shape: z.enum(['rect', 'ellipse']).optional(),
          x: z.number().optional(),
          z: z.number().optional(),
          width: z.number().optional(),
          depth: z.number().optional(),
          height: z.number().optional(),
          rotation: z.number().optional(),
          plateau: z.number().optional(),
        })
        .describe('Fields to change; which apply depends on the item (props: kind, size, x, z, rotation; regions: surface, shape, size, x, z, rotation; spawns: x, z; hills: x, z, width, depth, rotation, height, plateau)'),
    })
    .describe("Change one item's fields"),
  z
    .strictObject({ op: z.literal('move'), items, dx: metres('Distance along x'), dz: metres('Distance along z'), snap: z.number().nonnegative().default(0).describe('Snap each position to this grid (0: none)') })
    .describe('Move items together; props stay on the floor'),
  z.strictObject({ op: z.literal('rotate'), items, degrees }).describe('Turn props and regions about their own centres'),
  z.strictObject({ op: z.literal('remove'), items }).describe(`Remove items (never below ${WORLD_LIMITS.minSpawnPoints} spawn points)`),
  z.strictObject({ op: z.literal('duplicate'), items, dx: z.number().default(1), dz: z.number().default(-1) }).describe('Copy items, offset by dx, dz'),
  z
    .strictObject({ op: z.literal('mirror'), items, symmetry: z.enum(['mirror-x', 'mirror-z', 'quad']) })
    .describe('Add mirror-image copies (left/right, front/back or four-way) for a fair world'),
  z.strictObject({ op: z.literal('reorder_region'), index: z.int().nonnegative(), direction: z.union([z.literal(1), z.literal(-1)]) }).describe('Move a floor patch up (1) or down (-1) the paint order'),
  z
    .strictObject({
      op: z.literal('set_floor'),
      width: z.number().min(size.min).max(size.max).optional().describe('Floor width in metres'),
      depth: z.number().min(size.min).max(size.max).optional().describe('Floor depth in metres'),
      theme: ThemeIdSchema.optional(),
      floor: SurfaceIdSchema.optional().describe('Ground surface'),
      scatter: z.number().min(0).max(1).optional().describe('Density of small decorations, 0–1 (looks only)'),
    })
    .describe('Change the floor: size, theme, ground surface or decorations'),
  WorldTerrainSchema.partial()
    .extend({ op: z.literal('set_terrain') })
    .describe('Change the rolling ground under the whole floor (relief 0 makes it flat apart from hills); what you leave out stays'),
  z.strictObject({ op: z.literal('clear'), what: z.enum(['props', 'regions', 'hills']) }).describe('Remove every prop, every floor patch, or every hill'),
  GenerateOptionsSchema.extend({ op: z.literal('generate') }).describe("Replace the whole layout with a generated one in the theme's props and surfaces"),
]);

export type WorldEdit = z.output<typeof WorldEditSchema>;

const LISTS = { prop: 'props', region: 'regions', spawn: 'spawnPoints', hill: 'hills' } as const;
const LIMITS = { prop: WORLD_LIMITS.maxProps, region: WORLD_LIMITS.maxRegions, spawn: WORLD_LIMITS.maxSpawnPoints, hill: WORLD_LIMITS.maxHills } as const;
const lengthOf = (layout: WorldLayout, kind: keyof typeof LISTS) => layout[LISTS[kind]]?.length ?? 0;

/**
 * Apply edits in order. Each edit sees the layout as the edits before it left it, so indices
 * refer to the lists at that point. A reference to a missing item, or an edit past a limit,
 * rejects the whole batch.
 */
export function applyWorldEdits(start: WorldLayout, edits: readonly WorldEdit[]): WorldLayout {
  let layout = start;
  edits.forEach((edit, n) => {
    const fail = (message: string): never => {
      throw new OperationError('invalid', `Edit ${n + 1} (${edit.op}): ${message}`, [{ path: `edits.${n}`, message }]);
    };
    const check = (refs: readonly LayoutItemRef[]) => {
      for (const ref of refs) {
        const length = lengthOf(layout, ref.kind);
        if (ref.index >= length) fail(`there is no ${ref.kind} ${ref.index} (the layout has ${length} ${LISTS[ref.kind]})`);
      }
    };
    const room = (kind: keyof typeof LISTS, adding: number) => {
      if (lengthOf(layout, kind) + adding > LIMITS[kind]) fail(`a world holds at most ${LIMITS[kind]} ${LISTS[kind]}`);
    };
    switch (edit.op) {
      case 'add_prop': {
        room('prop', 1);
        const { op: _op, kind, x, z, rotation, ...options } = edit;
        layout = { ...layout, props: [...layout.props, prop(kind, x, z, { ...options, rotation })] };
        break;
      }
      case 'add_ring': {
        room('prop', edit.count);
        const { kind, count, radius, x, z, op: _op, ...options } = edit;
        const placed = ring(kind, count, radius, options).map((p) => ({ ...p, x: round(p.x + x), z: round(p.z + z) }));
        layout = { ...layout, props: [...layout.props, ...placed] };
        break;
      }
      case 'add_region': {
        room('region', 1);
        const { op: _op, ...region } = edit;
        layout = { ...layout, regions: [...layout.regions, region] };
        break;
      }
      case 'add_spawn':
        room('spawn', 1);
        layout = { ...layout, spawnPoints: [...layout.spawnPoints, { x: edit.x, z: edit.z }] };
        break;
      case 'add_hill': {
        room('hill', 1);
        const { op: _op, ...hill } = edit;
        layout = { ...layout, hills: [...(layout.hills ?? []), hill] };
        break;
      }
      case 'update': {
        check([edit.item]);
        const allowed = {
          prop: ['kind', 'x', 'z', 'width', 'depth', 'height', 'rotation'],
          region: ['surface', 'shape', 'x', 'z', 'width', 'depth', 'rotation'],
          spawn: ['x', 'z'],
          hill: ['x', 'z', 'width', 'depth', 'rotation', 'height', 'plateau'],
        }[edit.item.kind];
        const wrong = Object.keys(edit.set).filter((key) => !allowed.includes(key));
        if (wrong.length > 0) fail(`a ${edit.item.kind} has no ${wrong.join(', ')}`);
        layout = updateItem(layout, edit.item, edit.set);
        break;
      }
      case 'move':
        check(edit.items);
        layout = moveItems(layout, edit.items, edit.dx, edit.dz, edit.snap);
        break;
      case 'rotate':
        check(edit.items);
        layout = rotateItems(layout, edit.items, edit.degrees);
        break;
      case 'remove':
        check(edit.items);
        layout = deleteItems(layout, edit.items);
        break;
      case 'duplicate':
        check(edit.items);
        layout = duplicateItems(layout, edit.items, edit.dx, edit.dz).layout;
        break;
      case 'mirror':
        check(edit.items);
        layout = mirrorItems(layout, edit.items, edit.symmetry).layout;
        break;
      case 'reorder_region':
        check([{ kind: 'region', index: edit.index }]);
        layout = reorderRegion(layout, edit.index, edit.direction).layout;
        break;
      case 'set_floor':
        layout = {
          ...layout,
          ...(edit.width !== undefined ? { halfWidth: edit.width / 2 } : {}),
          ...(edit.depth !== undefined ? { halfDepth: edit.depth / 2 } : {}),
          ...(edit.theme !== undefined ? { theme: edit.theme } : {}),
          ...(edit.floor !== undefined ? { floor: edit.floor } : {}),
          ...(edit.scatter !== undefined ? { scatter: edit.scatter } : {}),
        };
        break;
      case 'set_terrain': {
        const { op: _op, ...changes } = edit;
        layout = { ...layout, terrain: { ...(layout.terrain ?? DEFAULT_TERRAIN), ...changes } };
        break;
      }
      case 'clear':
        layout = { ...layout, [edit.what]: [] };
        break;
      case 'generate': {
        const { op: _op, ...options } = edit;
        layout = generateLayout(options);
        break;
      }
    }
  });
  return layout;
}

const round = (v: number) => Math.round(v * 100) / 100;
