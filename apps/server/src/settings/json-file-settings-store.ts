import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  LegacyWorldLayoutSchema,
  SECTION_SCHEMAS,
  type SectionValue,
  type SectionValues,
  type SettingsSection,
  type Versioned,
  WorldSchema,
} from '@volleyland/contracts';
import { BUILTIN_WORLDS, DEFAULT_GAME_CONFIG, PROTOTYPE_WORLD, type World, type WorldLayout } from '@volleyland/game-core';
import { InMemorySettingsStore, type SettingsState } from './in-memory-settings-store.js';
import type { SettingsStore, StoredSections } from './settings-store.js';

/**
 * Bump when the file layout changes, and migrate older files on load.
 * - 1: worlds were floors with cover blocks (`obstacles`).
 * - 2: worlds have a theme, floor, painted regions and props; the file lists the seeded worlds.
 * - 3: the movement section has the steepest climb (`maxSlopeDeg`). Worlds may have terrain and
 *   hills, but those are optional, so format 2 worlds need no change.
 * - 4: question pools name curricula (`curriculumIds`), and a world may have its own pool
 *   (`questions`, optional). Built-in worlds got their own pools in this version.
 */
const FILE_FORMAT = 4;

interface SettingsFile extends SettingsState {
  format: number;
}

/**
 * Phase 0 persistence: settings and worlds in one JSON file (SETTINGS_FILE, default
 * data/settings.json under the server's working directory). It keeps the working copy in an
 * InMemorySettingsStore and rewrites the whole file after each change, atomically (temp file +
 * rename), one write at a time. Good for a single server process; a database store replaces it
 * when there are several, or when settings need history and auditing.
 *
 * The file is validated on load with the same schemas as admin writes, so a hand-edited file
 * with a mistake stops the server at startup instead of reaching a match.
 */
export class JsonFileSettingsStore implements SettingsStore {
  private readonly memory: InMemorySettingsStore;
  private loaded: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    readonly filePath: string,
    now: () => Date = () => new Date(),
  ) {
    this.memory = new InMemorySettingsStore(now);
  }

  async loadSections(): Promise<Partial<StoredSections>> {
    await this.ensureLoaded();
    return this.memory.loadSections();
  }

  async seed(sections: SectionValues, worlds: readonly World[]): Promise<void> {
    await this.ensureLoaded();
    const before = JSON.stringify(this.memory.snapshot());
    await this.memory.seed(sections, worlds);
    if (JSON.stringify(this.memory.snapshot()) !== before) await this.persist();
  }

  async saveSection<S extends SettingsSection>(section: S, value: SectionValue<S>, expectedVersion: number): Promise<Versioned<SectionValue<S>>> {
    return this.change(() => this.memory.saveSection(section, value, expectedVersion));
  }

  async listWorlds(): Promise<Versioned<World>[]> {
    await this.ensureLoaded();
    return this.memory.listWorlds();
  }

  async createWorld(world: World): Promise<Versioned<World>> {
    return this.change(() => this.memory.createWorld(world));
  }

  async updateWorld(world: World, expectedVersion: number): Promise<Versioned<World>> {
    return this.change(() => this.memory.updateWorld(world, expectedVersion));
  }

  async deleteWorld(id: string, expectedVersion: number): Promise<void> {
    return this.change(() => this.memory.deleteWorld(id, expectedVersion));
  }

  private async change<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureLoaded();
    const result = await operation();
    await this.persist();
    return result;
  }

  private ensureLoaded(): Promise<void> {
    this.loaded ??= this.readFile();
    return this.loaded;
  }

  private async readFile(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; // first start: the caller seeds
      throw error;
    }
    this.memory.restore(parseSettingsFile(text, this.filePath));
  }

  /** Queue a full rewrite of the file with the current state. */
  private persist(): Promise<void> {
    const file: SettingsFile = { format: FILE_FORMAT, ...this.memory.snapshot() };
    const write = this.writes.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
      await rename(temp, this.filePath);
    });
    this.writes = write.catch(() => {}); // a failed write must not block later ones
    return write;
  }
}

export function parseSettingsFile(text: string, source = 'settings file'): SettingsState {
  const fail = (message: string): never => {
    throw new Error(`Invalid ${source}: ${message}`);
  };
  let file: Partial<SettingsFile>;
  try {
    file = JSON.parse(text) as Partial<SettingsFile>;
  } catch (error) {
    return fail(`not JSON (${(error as Error).message})`);
  }
  if (file.format === 1) file = migrateFormat1(file, fail);
  if (file.format === 2) file = migrateFormat2(file);
  if (file.format === 3) file = migrateFormat3(file);
  if (file.format !== FILE_FORMAT) fail(`unsupported format ${String(file.format)} (expected ${FILE_FORMAT})`);
  const worlds = Array.isArray(file.worlds) ? file.worlds : fail('worlds must be an array');
  for (const record of worlds) {
    const result = WorldSchema.safeParse(record?.value);
    if (!result.success) fail(`world ${String(record?.value?.id)}: ${result.error.issues[0]?.message}`);
  }
  const seededWorlds = Array.isArray(file.seededWorlds) && file.seededWorlds.every((id) => typeof id === 'string') ? file.seededWorlds : fail('seededWorlds must be a list of world IDs');
  const sections = file.sections ?? {};
  for (const [name, record] of Object.entries(sections)) {
    if (!(name in SECTION_SCHEMAS)) fail(`unknown section ${name}`);
    const result = SECTION_SCHEMAS[name as SettingsSection].safeParse(record?.value);
    if (!result.success) fail(`section ${name}: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  // Sections missing here (added in a newer version) are filled with defaults by the next seed.
  return { sections, worlds, seededWorlds };
}

/**
 * Format 1 → 2: each world's cover blocks become `block` props in the classic theme (the look
 * they had), and the only world format 1 ever seeded was the prototype court. Versions are kept.
 */
function migrateFormat1(file: Partial<SettingsFile>, fail: (message: string) => never): Partial<SettingsFile> {
  const worlds = Array.isArray(file.worlds) ? file.worlds : fail('worlds must be an array');
  return {
    ...file,
    format: 2,
    seededWorlds: [PROTOTYPE_WORLD.id],
    worlds: worlds.map((record) => {
      const legacy = LegacyWorldLayoutSchema.safeParse(record?.value?.layout);
      if (!legacy.success) return fail(`world ${String(record?.value?.id)}: not a format 1 world (${legacy.error.issues[0]?.message})`);
      return { ...record, value: { ...record.value, layout: layoutFromFormat1(legacy.data) } };
    }),
  };
}

/**
 * Format 2 → 3: a stored movement section gets the default steepest climb. Its version is kept:
 * nothing anyone saved changed, and a flat world plays exactly as before.
 */
function migrateFormat2(file: Partial<SettingsFile>): Partial<SettingsFile> {
  const sections = { ...file.sections };
  const movement = sections.movement as { value?: unknown } | undefined;
  const value = movement?.value;
  if (movement && value && typeof value === 'object' && !('maxSlopeDeg' in value)) {
    sections.movement = { ...movement, value: { ...(value as object), maxSlopeDeg: DEFAULT_GAME_CONFIG.maxSlopeDeg } } as typeof sections.movement;
  }
  return { ...file, format: 3, sections };
}

/**
 * Format 3 → 4: the stored room-wide pool gets an empty curriculum list (every curriculum, as
 * before), and each stored built-in world gets the pool it now ships with, so existing installs
 * get the new defaults too. Worlds admins built keep asking from the room-wide pool. Versions are
 * kept: nothing anyone saved changed.
 */
function migrateFormat3(file: Partial<SettingsFile>): Partial<SettingsFile> {
  const sections = { ...file.sections };
  const questions = sections.questions as { value?: unknown } | undefined;
  const value = questions?.value;
  if (questions && value && typeof value === 'object' && !('curriculumIds' in value)) {
    sections.questions = { ...questions, value: { curriculumIds: [], ...(value as object) } } as unknown as typeof sections.questions;
  }
  const builtin = new Map(BUILTIN_WORLDS.map((w) => [w.id, w.questions]));
  const worlds = Array.isArray(file.worlds)
    ? file.worlds.map((record) => {
        const pool = builtin.get(record?.value?.id);
        return pool && record.value.questions === undefined ? { ...record, value: { ...record.value, questions: structuredClone(pool) } } : record;
      })
    : file.worlds;
  return { ...file, format: 4, sections, ...(worlds ? { worlds } : {}) };
}

export function layoutFromFormat1(legacy: { halfWidth: number; halfDepth: number; obstacles: { x: number; z: number; width: number; depth: number; height: number }[]; spawnPoints: { x: number; z: number }[] }): WorldLayout {
  return {
    halfWidth: legacy.halfWidth,
    halfDepth: legacy.halfDepth,
    theme: 'classic',
    floor: 'court',
    scatter: 0,
    regions: [],
    props: legacy.obstacles.map((o) => ({ kind: 'block', x: o.x, z: o.z, width: o.width, depth: o.depth, height: o.height, rotation: 0 })),
    spawnPoints: legacy.spawnPoints,
  };
}
