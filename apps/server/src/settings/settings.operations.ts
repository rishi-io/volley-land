import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminSettingsResponse,
  QuestionPoolSchema,
  SECTION_SCHEMAS,
  SECTION_TEXT,
  type SectionValue,
  SettingsSection,
  type Versioned,
  WORLD_LIMITS,
  WorldIdSchema,
  WorldLayoutSchema,
  WorldSchema,
} from '@volleyland/contracts';
import { PROPS, PROP_KINDS, SURFACES, THEMES, THEME_INFO, type World, type WorldLayout, blankLayout, checkWorld, generateLayout, playRulesOf } from '@volleyland/game-core';
import { z } from 'zod';
import { type AnyOperation, OperationError, type OperationProvider, Operations, defineOperation, issuesOf } from '../operations/operation.js';
import { SettingsService } from './settings.service.js';
import { GenerateOptionsSchema, WorldEditSchema, applyWorldEdits } from './world-edits.js';

const expectedVersion = z
  .int()
  .positive()
  .describe('The version you last read (get_settings, get_world or list_worlds). If someone saved since, the call fails with a conflict: read again, then retry.');

const dryRun = z.boolean().default(false).describe('Check the result (validation and play checks) without saving it');

/** Rules, rooms and bots restart open matches; appearance and camera are applied in place. */
const effectOf = (section: SettingsSection): string =>
  section === 'appearance' || section === 'camera'
    ? `Open rooms ${section === 'camera' ? 'switch to the new view' : 'redraw with the new look'} at once; matches keep running.`
    : section === 'questions'
      ? "Applies only in worlds without their own pool (a world's questions, set with update_world, come first). Open rooms in such a world start a new match at once (players respawn; they are told what changed)."
      : 'Open rooms start a new match with the new settings at once (players respawn; they are told what changed).';

const worldQuestions = QuestionPoolSchema.describe(
  "The world's own question pool: question banks (curriculum IDs), classes or years (level IDs), subjects (subject IDs), each empty for all, and difficulty [min, max]. " +
    'Check it first with preview_question_pool. Without one, the world asks from the room-wide pool (update_questions_settings).',
);

export interface WorldSummary {
  id: string;
  name: string;
  description: string;
  theme: string;
  floor: string;
  size: { width: number; depth: number };
  props: number;
  regions: number;
  spawnPoints: number;
  /** How much the ground rolls (0: flat) and how many hills it carries. */
  terrain: { relief: number; hills: number };
  /** The world's own question pool, or "room" when it asks from the room-wide pool. */
  questions: World['questions'] | 'room';
}

export const summarizeWorld = (world: World): WorldSummary => ({
  id: world.id,
  name: world.name,
  description: world.description,
  theme: world.layout.theme,
  floor: world.layout.floor,
  size: { width: world.layout.halfWidth * 2, depth: world.layout.halfDepth * 2 },
  props: world.layout.props.length,
  regions: world.layout.regions.length,
  spawnPoints: world.layout.spawnPoints.length,
  terrain: { relief: world.layout.terrain?.relief ?? 0, hills: world.layout.hills?.length ?? 0 },
  questions: world.questions ?? 'room',
});

const summarizeRecord = (record: Versioned<World>) => ({ ...summarizeWorld(record.value), version: record.version, updatedAt: record.updatedAt });

/** A world change checked but not saved. */
export interface WorldDryRun {
  dryRun: true;
  valid: boolean;
  issues: { path: string; message: string }[];
  world: WorldSummary;
  checks: ReturnType<typeof checkWorld>['checks'];
}

/**
 * Every admin panel action as an operation: settings sections, worlds and the world builder.
 * The admin REST API (AdminController) and the MCP server both run these through
 * OperationRunner. All rules stay in SettingsService and game-core; this file only names the
 * actions and shapes their input for callers.
 */
@Operations()
@Injectable()
export class SettingsOperations implements OperationProvider {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  readonly getSettings = defineOperation({
    name: 'get_settings',
    title: 'Get settings',
    description:
      'Every settings section with its current values and version, the code defaults for each, and the room code players join. ' +
      'Sections: ' +
      SettingsSection.options.map((s) => `${s} (${SECTION_TEXT[s].title})`).join(', ') +
      '. Worlds are listed by list_worlds.',
    input: z.object({}),
    access: 'read',
    run: (): Omit<AdminSettingsResponse, 'worlds'> => {
      const { devRoomCode, sections, defaults } = this.settings.view();
      return { devRoomCode, sections, defaults };
    },
  });

  private readonly updateSectionOps = new Map(SettingsSection.options.map((section) => [section, this.updateSectionOperation(section)]));

  /** The update operation for one section (update_<section>_settings). */
  updateSection(section: SettingsSection) {
    return this.updateSectionOps.get(section)!;
  }

  readonly resetSection = defineOperation({
    name: 'reset_settings_section',
    title: 'Reset a settings section to defaults',
    description: 'Put every setting in one section back to its code default (the admin panel’s "Use defaults").',
    input: z.object({ section: SettingsSection, expectedVersion }),
    access: 'write',
    run: ({ section, expectedVersion }) => this.settings.updateSection(section, this.settings.defaults(section), expectedVersion),
  });

  readonly listWorlds = defineOperation({
    name: 'list_worlds',
    title: 'List worlds',
    description: 'Every world with its version and whether rooms play in it now (inUse). Summaries by default; detail "full" includes each layout.',
    input: z.object({ detail: z.enum(['summary', 'full']).default('summary') }),
    access: 'read',
    run: ({ detail }) => {
      const inUse = this.settings.section('rooms').value.worldId;
      const records = this.settings.worldRecords();
      return detail === 'full' ? records : records.map((r) => ({ ...summarizeRecord(r), inUse: r.value.id === inUse }));
    },
  });

  readonly getWorld = defineOperation({
    name: 'get_world',
    title: 'Get a world',
    description:
      'One world in full: name, description, its own question pool if it has one, and layout (floor size, theme, ground surface, floor patches, props, spawn points, and the terrain and hills that shape the ground) with its version. ' +
      'Items are addressed by their position in the props, regions, spawnPoints and hills lists when editing.',
    input: z.object({ id: WorldIdSchema }),
    access: 'read',
    run: ({ id }) => this.requireWorld(id),
  });

  readonly getWorldCatalogue = defineOperation({
    name: 'get_world_catalogue',
    title: 'World building catalogue',
    description: 'What worlds are built from: themes (their ground, props and path surfaces), ground surfaces, prop kinds with shapes and default sizes, and the limits. Read this before building a world.',
    input: z.object({}),
    access: 'read',
    run: () => ({
      coordinates:
        'The floor is centred on (0, 0): x runs from -width/2 to width/2, z from -depth/2 to depth/2, in metres. Rotation is in degrees, counter-clockwise seen from above. Every prop blocks movement; throws fly over props lower than the projectile flight height. ' +
        'Ground is flat unless the layout has terrain (rolling ground: relief, scale, seed, symmetry) or hills (oval mounds, or hollows with negative height). Props and players stand on the ground; hills block sight and throws like cover, and slopes steeper than the movement rules allow can only be walked down.',
      themes: THEMES.map((id) => ({ id, name: THEME_INFO[id].name, floor: THEME_INFO[id].floor, props: Object.keys(THEME_INFO[id].props), paths: THEME_INFO[id].paths, patches: THEME_INFO[id].patches })),
      surfaces: [...SURFACES],
      props: PROP_KINDS.map((kind) => ({ kind, name: PROPS[kind].name, shape: PROPS[kind].shape === 'circle' ? 'circle (width is the diameter)' : 'box', size: PROPS[kind].size })),
      limits: WORLD_LIMITS,
    }),
  });

  readonly checkPlay = defineOperation({
    name: 'check_world',
    title: 'Check how a world plays',
    description:
      "The world builder's play checks under the live rules: spawn points walled off, floor no one can reach, spawn points in each other's line of fire, and whether the floor suits the room's player count. " +
      'Pass a saved world id, or a layout to check before saving.',
    input: z
      .object({ id: WorldIdSchema.optional(), layout: WorldLayoutSchema.optional() })
      .refine((i) => (i.id === undefined) !== (i.layout === undefined), 'pass either id or layout'),
    access: 'read',
    run: ({ id, layout }) => this.playChecks(layout ?? this.requireWorld(id!).value.layout),
  });

  readonly createWorld = defineOperation({
    name: 'create_world',
    title: 'Create a world',
    description:
      'Create a world from a blank floor, a generated layout, a copy of another world, or a full layout. Then refine it with edit_world and review it with check_world. ' +
      'Creating does not put it in rooms: set it with update_rooms_settings (worldId).',
    input: z.object({
      id: WorldIdSchema.describe('Stable ID: lowercase letters, digits and single hyphens. Cannot change later'),
      name: WorldSchema.shape.name,
      description: WorldSchema.shape.description.default(''),
      questions: worldQuestions.optional().describe(`${worldQuestions.description} A copy keeps the copied world's pool unless you pass one.`),
      start: z
        .discriminatedUnion('from', [
          z.strictObject({ from: z.literal('blank'), theme: WorldLayoutSchema.shape.theme.default('park') }).describe('An empty 60 × 60 m floor with four spawn points'),
          GenerateOptionsSchema.extend({ from: z.literal('generate') }).describe("A generated layout in the theme's props and surfaces"),
          z.strictObject({ from: z.literal('copy'), worldId: WorldIdSchema }).describe("Another world's layout"),
          z.strictObject({ from: z.literal('layout'), layout: WorldLayoutSchema.describe('A full layout, as get_world returns it') }).describe('A layout you provide'),
        ])
        .describe('What the new world starts from'),
      dryRun,
    }),
    access: 'write',
    run: async ({ id, name, description, questions, start, dryRun }): Promise<Versioned<World> | WorldDryRun> => {
      const layout =
        start.from === 'blank'
          ? blankLayout(start.theme)
          : start.from === 'generate'
            ? generateLayout(start)
            : start.from === 'copy'
              ? this.requireWorld(start.worldId).value.layout
              : start.layout;
      const pool = questions ?? (start.from === 'copy' ? this.requireWorld(start.worldId).value.questions : undefined);
      const world: World = { id, name, description, layout, ...(pool ? { questions: pool } : {}) };
      if (dryRun) return this.dryRun(world);
      return this.settings.saveWorld(world, null);
    },
    summarize: (output) => ('dryRun' in output ? output : summarizeRecord(output)),
  });

  readonly updateWorld = defineOperation({
    name: 'update_world',
    title: 'Replace parts of a world',
    description:
      "Replace a world's name, description, question pool or whole layout (what you leave out stays). For changes to individual props, patches or spawn points use edit_world. " +
      'A new pool applies in open rooms playing this world from a new match, started at once.',
    input: z.object({
      id: WorldIdSchema,
      expectedVersion,
      name: WorldSchema.shape.name.optional(),
      description: WorldSchema.shape.description.optional(),
      questions: worldQuestions.nullable().optional().describe(`${worldQuestions.description} null removes the world's own pool, so it asks from the room-wide one.`),
      layout: WorldLayoutSchema.optional().describe('A full layout, as get_world returns it'),
    }),
    access: 'write',
    run: ({ id, expectedVersion, name, description, questions, layout }) => {
      const { questions: currentPool, ...current } = this.requireWorld(id).value;
      const pool = questions === undefined ? currentPool : (questions ?? undefined);
      const world: World = {
        id,
        name: name ?? current.name,
        description: description ?? current.description,
        layout: layout ?? current.layout,
        ...(pool ? { questions: pool } : {}),
      };
      return this.settings.saveWorld(world, expectedVersion);
    },
    summarize: summarizeRecord,
  });

  readonly editWorld = defineOperation({
    name: 'edit_world',
    title: 'Edit a world',
    description:
      'Apply world builder edits in order, then save once: add props (one, or a ring), floor patches, spawn points and hills; update, move, rotate, duplicate, mirror or remove items; ' +
      'change the floor or the rolling ground; or generate a new layout. Items are { kind: prop | region | spawn | hill, index }, the position in that list as the earlier edits in the batch left it. ' +
      'Read the world first (get_world) and the catalogue (get_world_catalogue); use dryRun to see validation and play checks without saving.',
    input: z.object({ id: WorldIdSchema, expectedVersion, edits: z.array(WorldEditSchema).min(1).max(200), dryRun }),
    access: 'write',
    run: async ({ id, expectedVersion, edits, dryRun }): Promise<Versioned<World> | WorldDryRun> => {
      const record = this.requireWorld(id);
      if (record.version !== expectedVersion) {
        throw new OperationError('conflict', `Someone else saved this world first (now at v${record.version}). Read it again and reapply your edits.`);
      }
      const world = { ...record.value, layout: applyWorldEdits(record.value.layout, edits) };
      if (dryRun) return this.dryRun(world);
      return this.settings.saveWorld(world, expectedVersion);
    },
    summarize: (output) => ('dryRun' in output ? output : summarizeRecord(output)),
  });

  readonly deleteWorld = defineOperation({
    name: 'delete_world',
    title: 'Delete a world',
    description: 'Delete a world for good. The world rooms play in cannot be deleted: pick another one first (update_rooms_settings).',
    input: z.object({ id: WorldIdSchema, expectedVersion }),
    access: 'write',
    destructive: true,
    run: async ({ id, expectedVersion }) => {
      await this.settings.deleteWorld(id, expectedVersion);
    },
  });

  operations(): AnyOperation[] {
    return [
      this.getSettings,
      ...this.updateSectionOps.values(),
      this.resetSection,
      this.listWorlds,
      this.getWorld,
      this.getWorldCatalogue,
      this.checkPlay,
      this.createWorld,
      this.updateWorld,
      this.editWorld,
      this.deleteWorld,
    ];
  }

  private updateSectionOperation<S extends SettingsSection>(section: S) {
    const schema = SECTION_SCHEMAS[section];
    const { title, summary } = SECTION_TEXT[section];
    return defineOperation({
      name: `update_${section}_settings`,
      title: `Update ${title.toLowerCase()} settings`,
      description: `${title}: ${summary} Pass only the settings to change in "changes"; the rest keep their values. ${effectOf(section)}`,
      input: z.object({
        expectedVersion,
        changes: z
          .strictObject(schema.shape)
          .partial()
          .refine((c) => Object.keys(c).length > 0, 'name at least one setting to change'),
      }),
      access: 'write',
      run: ({ expectedVersion, changes }): Promise<Versioned<SectionValue<S>>> =>
        this.settings.updateSection(section, { ...this.settings.section(section).value, ...changes }, expectedVersion),
    });
  }

  private requireWorld(id: string): Versioned<World> {
    const record = this.settings.worldRecord(id);
    if (!record) throw new OperationError('not_found', `No world "${id}". list_worlds shows the worlds there are.`);
    return record;
  }

  private playChecks(layout: WorldLayout) {
    const live = this.settings.live();
    const { checks, unreachable, exposedPairs } = checkWorld(layout, playRulesOf(live.game, live.rooms.maxPlayers));
    return { checks, unreachableArea: Math.round(unreachable.reduce((sum, c) => sum + c.size * c.size, 0)), exposedSpawnPairs: exposedPairs.map(([a, b]) => [a + 1, b + 1]) };
  }

  private dryRun(world: World): WorldDryRun {
    const parsed = WorldSchema.safeParse(world);
    const issues = parsed.success ? this.settings.questionIssues(parsed.data) : issuesOf(parsed.error);
    return {
      dryRun: true,
      valid: issues.length === 0,
      issues,
      world: summarizeWorld(world),
      checks: parsed.success ? this.playChecks(world.layout).checks : [],
    };
  }
}
