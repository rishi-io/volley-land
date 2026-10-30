import { isDeepStrictEqual } from 'node:util';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type AdminSettingsResponse,
  GameConfigSchema,
  SECTION_SCHEMAS,
  SettingsSection,
  type SectionValue,
  type SectionValues,
  type Versioned,
  WorldSchema,
} from '@volleyland/contracts';
import type { AppearanceSettings, CameraSettings, GameConfig, World } from '@volleyland/game-core';
import type { BotConfig } from '../config/bot-config.js';
import { ROOM_SETTINGS, type RoomSettings } from '../config/server-config.js';
import { QUESTION_POOL_CHECK, type QuestionPool, type QuestionPoolCheck } from '../content-workflow/content.service.js';
import { OperationError, type OperationIssue, issuesOf } from '../operations/operation.js';
import { DEFAULT_SECTIONS, SETTINGS_SEED, type SettingsSeed, gameConfigFrom } from './defaults.js';
import { RecordNotFoundError, SETTINGS_STORE, type SettingsStore, type StoredSections, VersionConflictError } from './settings-store.js';

export type RoomRules = SectionValue<'rooms'>;

/** Everything a new match is configured with, frozen at the moment the room opens. */
export interface LiveSettings {
  game: GameConfig;
  rooms: RoomRules;
  /**
   * The room-wide question pool, for worlds without their own (see questionPoolOf). Resolved per
   * hit, so CMS edits apply at once.
   */
  questions: QuestionPool;
  bots: BotConfig;
  appearance: AppearanceSettings;
  camera: CameraSettings;
  world: World;
}

/** The questions a match under these settings asks: its world's own pool, else the room-wide one. */
export const questionPoolOf = (live: Pick<LiveSettings, 'questions' | 'world'>): QuestionPool => live.world.questions ?? live.questions;

/** Told about the settings a match should now use, after every saved change. */
export type SettingsListener = (live: LiveSettings) => void;

/**
 * Admin-managed settings and worlds. Reads for the game are synchronous, from a cache loaded at
 * startup and refreshed after every write, so opening a room never waits on storage. Every write
 * is validated by its section schema plus the checks that span sections, then saved through the
 * SettingsStore with the version the caller last saw.
 *
 * A rejected change throws OperationError (invalid, conflict or not_found), which the admin
 * operations pass on to REST and MCP callers as is.
 *
 * Saved changes are announced to onChange listeners. The service does not decide what a change
 * means for running matches: the room registry does.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private sections: StoredSections | null = null;
  private worlds = new Map<string, Versioned<World>>();
  private readonly listeners = new Set<SettingsListener>();

  constructor(
    @Inject(SETTINGS_STORE) private readonly store: SettingsStore,
    @Inject(SETTINGS_SEED) private readonly seed: SettingsSeed,
    @Inject(ROOM_SETTINGS) private readonly roomSettings: RoomSettings,
    @Inject(QUESTION_POOL_CHECK) private readonly questionPool: QuestionPoolCheck,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.load();
  }

  /** Fill any missing sections (and worlds, on first start) with the defaults, then cache what is stored. */
  async load(): Promise<void> {
    const before = Object.keys(await this.store.loadSections());
    await this.store.seed(this.seed.sections, this.seed.worlds);
    const stored = await this.store.loadSections();
    const added = Object.keys(stored).filter((s) => !before.includes(s));
    if (added.length > 0) this.logger.log(`Seeded settings sections with defaults: ${added.join(', ')}`);
    const missing = SettingsSection.options.filter((s) => !stored[s]);
    if (missing.length > 0) throw new Error(`Settings store is missing sections after seeding: ${missing.join(', ')}`);
    this.sections = stored as StoredSections;
    this.worlds = new Map((await this.store.listWorlds()).map((w) => [w.value.id, w]));
    const worldId = this.requireLoaded().rooms.value.worldId;
    if (!this.worlds.has(worldId)) throw new Error(`Stored settings are inconsistent: rooms.worldId "${worldId}" is not a stored world`);
  }

  get devRoomCode(): string {
    return this.roomSettings.devRoomCode;
  }

  /** The settings a match opening now should use. */
  live(): LiveSettings {
    const sections = this.requireLoaded();
    const world = this.worlds.get(sections.rooms.value.worldId)?.value;
    if (!world) throw new Error(`Room world ${sections.rooms.value.worldId} does not exist`);
    return {
      game: gameConfigFrom({
        simulation: sections.simulation.value,
        combat: sections.combat.value,
        movement: sections.movement.value,
        projectiles: sections.projectiles.value,
        weapons: sections.weapons.value,
      }),
      rooms: sections.rooms.value,
      questions: sections.questions.value,
      bots: sections.bots.value,
      appearance: sections.appearance.value,
      camera: sections.camera.value,
      world,
    };
  }

  /** Be told after every saved change. Returns the function that stops the notifications. */
  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  view(): AdminSettingsResponse {
    return structuredClone({
      devRoomCode: this.devRoomCode,
      sections: this.requireLoaded(),
      defaults: DEFAULT_SECTIONS,
      worlds: this.worldRecords(),
    });
  }

  /** One settings section as stored, with its version. */
  section<S extends SettingsSection>(section: S): Versioned<SectionValue<S>> {
    return structuredClone(this.requireLoaded()[section]) as Versioned<SectionValue<S>>;
  }

  /** The code defaults for one section ("Use defaults" in the admin panel). */
  defaults<S extends SettingsSection>(section: S): SectionValue<S> {
    return structuredClone(DEFAULT_SECTIONS[section]) as SectionValue<S>;
  }

  /** Every stored world, by name. */
  worldRecords(): Versioned<World>[] {
    return structuredClone([...this.worlds.values()].sort((a, b) => a.value.name.localeCompare(b.value.name)));
  }

  worldRecord(id: string): Versioned<World> | null {
    const record = this.worlds.get(id);
    return record ? structuredClone(record) : null;
  }

  async updateSection<S extends SettingsSection>(section: S, raw: unknown, expectedVersion: number): Promise<Versioned<SectionValue<S>>> {
    const parsed = SECTION_SCHEMAS[section].safeParse(raw);
    if (!parsed.success) throw new OperationError('invalid', `Invalid ${section} settings`, issuesOf(parsed.error));
    const value = parsed.data as SectionValue<S>;
    this.checkAcrossSections({ ...this.currentValues(), [section]: value }, section);

    const saved = await this.write(() => this.store.saveSection(section, value, expectedVersion));
    (this.requireLoaded() as Record<SettingsSection, Versioned<unknown>>)[section] = saved;
    this.logger.log(`Settings section ${section} updated to v${saved.version}`);
    this.announce();
    return saved;
  }

  /** Create (expectedVersion null) or replace a world. */
  async saveWorld(raw: unknown, expectedVersion: number | null): Promise<Versioned<World>> {
    const parsed = WorldSchema.safeParse(raw);
    if (!parsed.success) throw new OperationError('invalid', 'Invalid world', issuesOf(parsed.error));
    const world: World = parsed.data;
    if (expectedVersion === null && this.worlds.has(world.id)) {
      throw new OperationError('conflict', `A world with ID "${world.id}" already exists`, [{ path: 'id', message: 'already taken' }]);
    }
    const issues = this.questionIssues(world);
    if (issues.length > 0) throw new OperationError('invalid', "This world's questions cannot be asked", issues);
    const saved = await this.write(() =>
      expectedVersion === null ? this.store.createWorld(world) : this.store.updateWorld(world, expectedVersion),
    );
    this.worlds.set(world.id, saved);
    this.logger.log(`World ${world.id} saved as v${saved.version}`);
    this.announce();
    return saved;
  }

  /**
   * Why a world's own question pool cannot be asked (unknown curricula, levels or subjects, or no
   * published question). Checked only when the pool changes: retiring questions in the CMS must
   * not block layout edits.
   */
  questionIssues(world: World): OperationIssue[] {
    if (!world.questions || isDeepStrictEqual(world.questions, this.worlds.get(world.id)?.value.questions)) return [];
    return this.questionPool.checkPool(world.questions).map((i) => ({ ...i, path: `questions.${i.path}` }));
  }

  async deleteWorld(id: string, expectedVersion: number): Promise<void> {
    if (!this.worlds.has(id)) throw new OperationError('not_found', `No world "${id}"`);
    if (this.requireLoaded().rooms.value.worldId === id) {
      throw new OperationError('invalid', 'This world is the one rooms use; pick another world in Rooms first');
    }
    await this.write(() => this.store.deleteWorld(id, expectedVersion));
    this.worlds.delete(id);
    this.logger.log(`World ${id} deleted`);
  }

  /** The write is already saved, so a failing listener is logged rather than failing the request. */
  private announce(): void {
    const live = this.live();
    for (const listener of this.listeners) {
      try {
        listener(live);
      } catch (error) {
        this.logger.error('Settings change listener failed', error instanceof Error ? error.stack : String(error));
      }
    }
  }

  private currentValues(): SectionValues {
    const s = this.requireLoaded();
    return {
      simulation: s.simulation.value,
      combat: s.combat.value,
      movement: s.movement.value,
      projectiles: s.projectiles.value,
      weapons: s.weapons.value,
      rooms: s.rooms.value,
      questions: s.questions.value,
      bots: s.bots.value,
      appearance: s.appearance.value,
      camera: s.camera.value,
    };
  }

  /** Rules that involve more than one section (or a section and the worlds or question bank). */
  private checkAcrossSections(values: SectionValues, changed: SettingsSection): void {
    const issues: OperationIssue[] = [];
    const game = GameConfigSchema.safeParse(gameConfigFrom(values));
    if (!game.success) issues.push(...issuesOf(game.error));
    if (values.projectiles.projectileHeight >= values.movement.playerHeight) {
      issues.push({ path: 'projectileHeight', message: `must be below playerHeight (${values.movement.playerHeight}) or nothing can be hit` });
    }
    if (!this.worlds.has(values.rooms.worldId)) {
      issues.push({ path: 'worldId', message: `no world "${values.rooms.worldId}"` });
    }
    // Only when the pool itself changes: retiring questions in the CMS must not block saving other sections.
    if (changed === 'questions') issues.push(...this.questionPool.checkPool(values.questions));
    if (issues.length > 0) throw new OperationError('invalid', 'These settings conflict with other settings', issues);
  }

  private async write<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof VersionConflictError) {
        throw new OperationError('conflict', `Someone else saved this first (now at v${error.current}). Reload and reapply your change.`);
      }
      if (error instanceof RecordNotFoundError) throw new OperationError('not_found', error.message);
      throw error;
    }
  }

  private requireLoaded(): StoredSections {
    if (!this.sections) throw new Error('SettingsService used before load()');
    return this.sections;
  }
}
