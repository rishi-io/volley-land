import { z } from 'zod';
import { QuestionPoolSchema } from './question-bank.js';

const finite = z.number().refine(Number.isFinite, 'must be finite');
const degrees = z.number().min(0).lt(360);

export const WORLD_LIMITS = {
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
} as const;

/*
 * Mirrors of game-core's catalogues (contracts does not depend on game-core). A server test
 * checks that the two lists match.
 */
export const ThemeIdSchema = z.enum(['classic', 'park', 'schoolyard', 'beach', 'snow', 'library', 'space']);
export const SurfaceIdSchema = z.enum(['court', 'grass', 'dirt', 'sand', 'cobbles', 'boards', 'tiles', 'carpet', 'snow', 'ice', 'asphalt', 'rubber', 'metal']);
export const PropKindSchema = z.enum([
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
  'tower',
  'rampart',
  'gatehouse',
  'well',
  'cart',
  'haybale',
  'noticeboard',
  'car',
  'bus',
  'container',
  'vending',
  'dumpster',
  'barrier',
  'billboard',
  'reactor',
  'forcefield',
  'crystal',
  'dish',
  'rover',
  'pylon',
  'hologram',
]);
/** Props whose footprint is a circle (width is the diameter); the rest are turned boxes. */
export const CIRCLE_PROPS: ReadonlySet<z.infer<typeof PropKindSchema>> = new Set([
  'barrel',
  'rock',
  'tree',
  'pine',
  'palm',
  'pillar',
  'lamp',
  'fountain',
  'pond',
  'snowman',
  'cactus',
  'sandcastle',
  'tire',
  'pod',
  'tower',
  'well',
  'reactor',
  'crystal',
  'dish',
  'pylon',
]);

/** Lowercase slug: a world's stable ID (rooms refer to worlds by it). */
export const WorldIdSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lowercase letters, digits and single hyphens');

export const WorldPropSchema = z
  .strictObject({
    kind: PropKindSchema,
    x: finite,
    z: finite,
    width: z.number().min(0.2).max(WORLD_LIMITS.maxPropSize),
    depth: z.number().min(0.2).max(WORLD_LIMITS.maxPropSize),
    height: z.number().min(0.1).max(WORLD_LIMITS.maxPropHeight),
    rotation: degrees,
  })
  .refine((p) => !CIRCLE_PROPS.has(p.kind) || p.depth === p.width, { message: 'a round prop is as deep as it is wide', path: ['depth'] });

export const FloorRegionSchema = z.strictObject({
  surface: SurfaceIdSchema,
  shape: z.enum(['rect', 'ellipse']),
  x: finite,
  z: finite,
  width: z.number().min(0.5).max(400),
  depth: z.number().min(0.5).max(400),
  rotation: degrees,
});

export const WorldPointSchema = z.strictObject({ x: finite, z: finite });

/** Mirrors game-core's layout-tools Symmetry. */
export const SymmetrySchema = z.enum(['none', 'mirror-x', 'mirror-z', 'quad']);

/** Mirrors game-core's WorldTerrain: rolling ground over the whole floor. */
export const WorldTerrainSchema = z.strictObject({
  relief: z.number().min(0).max(WORLD_LIMITS.maxRelief).describe('How much the ground rolls: roughly the height between low and high ground, in metres (0: flat)'),
  scale: z.number().min(WORLD_LIMITS.minTerrainScale).max(WORLD_LIMITS.maxTerrainScale).describe('Typical distance from one rise to the next, in metres'),
  seed: z.int().nonnegative().max(1_000_000).describe('Picks the pattern; change it for different ground'),
  symmetry: SymmetrySchema.describe('Mirror the ground like the props, so no side has the high ground'),
});

/** Mirrors game-core's TerrainHill: a mound (height > 0) or hollow (height < 0). */
export const TerrainHillSchema = z.strictObject({
  x: finite,
  z: finite,
  width: z.number().min(WORLD_LIMITS.minHillSize).max(WORLD_LIMITS.maxHillSize),
  depth: z.number().min(WORLD_LIMITS.minHillSize).max(WORLD_LIMITS.maxHillSize),
  rotation: degrees,
  height: z.number().min(-WORLD_LIMITS.maxHillHeight).max(WORLD_LIMITS.maxHillHeight).describe('Metres above the ground round it; negative for a hollow'),
  plateau: z.number().min(0).max(0.9).describe('Share of the radius that is flat on top: 0 is a smooth dome, 0.8 a mesa'),
});

type Prop = z.infer<typeof WorldPropSchema>;

/** Half extents of the axis-aligned box round a prop (the same sums as game-core's propExtent). */
function extentOf(p: Prop): { x: number; z: number } {
  if (CIRCLE_PROPS.has(p.kind)) return { x: p.width / 2, z: p.width / 2 };
  const a = (p.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return { x: (p.width / 2) * c + (p.depth / 2) * s, z: (p.width / 2) * s + (p.depth / 2) * c };
}

/** Whether a floor point is inside a prop's footprint (turned box or circle). */
function propContains(p: Prop, x: number, z: number): boolean {
  const dx = x - p.x;
  const dz = z - p.z;
  if (CIRCLE_PROPS.has(p.kind)) return Math.hypot(dx, dz) < p.width / 2;
  const a = (p.rotation * Math.PI) / 180;
  const lx = dx * Math.cos(a) - dz * Math.sin(a);
  const lz = dx * Math.sin(a) + dz * Math.cos(a);
  return Math.abs(lx) < p.width / 2 && Math.abs(lz) < p.depth / 2;
}

/** Mirrors game-core's WorldLayout; checks that props and spawn points sit on the floor and spawns are clear. */
export const WorldLayoutSchema = z
  .strictObject({
    halfWidth: z.number().min(WORLD_LIMITS.minHalfExtent).max(WORLD_LIMITS.maxHalfExtent),
    halfDepth: z.number().min(WORLD_LIMITS.minHalfExtent).max(WORLD_LIMITS.maxHalfExtent),
    theme: ThemeIdSchema,
    floor: SurfaceIdSchema,
    scatter: z.number().min(0).max(1),
    regions: z.array(FloorRegionSchema).max(WORLD_LIMITS.maxRegions),
    props: z.array(WorldPropSchema).max(WORLD_LIMITS.maxProps),
    spawnPoints: z.array(WorldPointSchema).min(WORLD_LIMITS.minSpawnPoints).max(WORLD_LIMITS.maxSpawnPoints),
    /** Absent: flat ground (worlds made before terrain). */
    terrain: WorldTerrainSchema.optional(),
    hills: z.array(TerrainHillSchema).max(WORLD_LIMITS.maxHills).optional(),
  })
  .superRefine((layout, ctx) => {
    const slack = 1e-6;
    layout.props.forEach((p, i) => {
      const e = extentOf(p);
      if (Math.abs(p.x) + e.x > layout.halfWidth + slack || Math.abs(p.z) + e.z > layout.halfDepth + slack) {
        ctx.addIssue({ code: 'custom', path: ['props', i], message: `Prop ${i + 1} (${p.kind}) extends past the floor edge` });
      }
    });
    layout.regions.forEach((r, i) => {
      if (Math.abs(r.x) > layout.halfWidth || Math.abs(r.z) > layout.halfDepth) {
        ctx.addIssue({ code: 'custom', path: ['regions', i], message: `Floor patch ${i + 1} is centred off the floor` });
      }
    });
    layout.hills?.forEach((h, i) => {
      if (Math.abs(h.x) > layout.halfWidth || Math.abs(h.z) > layout.halfDepth) {
        ctx.addIssue({ code: 'custom', path: ['hills', i], message: `Hill ${i + 1} is centred off the floor` });
      }
    });
    layout.spawnPoints.forEach((s, i) => {
      if (Math.abs(s.x) > layout.halfWidth || Math.abs(s.z) > layout.halfDepth) {
        ctx.addIssue({ code: 'custom', path: ['spawnPoints', i], message: `Spawn point ${i + 1} is off the floor` });
        return;
      }
      const blocked = layout.props.findIndex((p) => propContains(p, s.x, s.z));
      if (blocked >= 0) {
        ctx.addIssue({ code: 'custom', path: ['spawnPoints', i], message: `Spawn point ${i + 1} is inside prop ${blocked + 1}` });
      }
    });
  });

/** Mirrors game-core's World. */
export const WorldSchema = z.strictObject({
  id: WorldIdSchema,
  name: z.string().trim().min(1).max(60),
  description: z.string().max(280),
  layout: WorldLayoutSchema,
  /**
   * The questions matches in this world ask. Absent: the room-wide pool (the `questions` settings
   * section). Server-side only: never sent to game clients.
   */
  questions: QuestionPoolSchema.optional().describe(
    'Which questions players are asked in this world: question banks (curricula), classes or years, subjects and difficulty. Leave it out to use the room-wide pool (the questions settings section).',
  ),
});

export type WorldDto = z.infer<typeof WorldSchema>;
export type WorldLayoutDto = z.infer<typeof WorldLayoutSchema>;
export type WorldPropDto = z.infer<typeof WorldPropSchema>;
export type FloorRegionDto = z.infer<typeof FloorRegionSchema>;
export type WorldTerrainDto = z.infer<typeof WorldTerrainSchema>;
export type TerrainHillDto = z.infer<typeof TerrainHillSchema>;
export type PropKindId = z.infer<typeof PropKindSchema>;
export type SurfaceIdValue = z.infer<typeof SurfaceIdSchema>;
export type ThemeIdValue = z.infer<typeof ThemeIdSchema>;

/**
 * A world as format 1 settings files stored it: cover blocks only. The server converts these to
 * the current layout on load (each block becomes a `block` prop in the classic theme).
 */
export const LegacyWorldLayoutSchema = z.strictObject({
  halfWidth: z.number(),
  halfDepth: z.number(),
  obstacles: z.array(z.strictObject({ x: finite, z: finite, width: z.number(), depth: z.number(), height: z.number() })),
  spawnPoints: z.array(WorldPointSchema),
});
