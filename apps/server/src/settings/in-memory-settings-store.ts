import type { SectionValue, SectionValues, SettingsSection, Versioned } from '@volleyland/contracts';
import type { World } from '@volleyland/game-core';
import { RecordNotFoundError, type SettingsStore, type StoredSections, VersionConflictError } from './settings-store.js';

/** Everything a store holds, as plain JSON (what the file store writes to disk). */
export interface SettingsState {
  sections: Partial<StoredSections>;
  worlds: Versioned<World>[];
  /** IDs of the seed worlds already offered to this store, whether or not they still exist. */
  seededWorlds: string[];
}

/**
 * Settings in process memory: the working copy behind JsonFileSettingsStore, and the store tests
 * use. Values are deep-copied in and out, as a database round trip would, so callers can never
 * share state with it.
 */
export class InMemorySettingsStore implements SettingsStore {
  private sections: Partial<StoredSections> = {};
  private readonly worlds = new Map<string, Versioned<World>>();
  private readonly seededWorlds = new Set<string>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** A deep copy of everything stored. */
  snapshot(): SettingsState {
    return structuredClone({ sections: this.sections, worlds: [...this.worlds.values()], seededWorlds: [...this.seededWorlds] });
  }

  /** Replace everything stored (used when loading from a file). */
  restore(state: SettingsState): void {
    this.sections = structuredClone(state.sections);
    this.worlds.clear();
    for (const world of state.worlds) this.worlds.set(world.value.id, structuredClone(world));
    this.seededWorlds.clear();
    for (const id of state.seededWorlds) this.seededWorlds.add(id);
  }

  async loadSections(): Promise<Partial<StoredSections>> {
    return structuredClone(this.sections);
  }

  async seed(sections: SectionValues, worlds: readonly World[]): Promise<void> {
    const updatedAt = this.now().toISOString();
    const record = <T>(value: T): Versioned<T> => ({ value: structuredClone(value), version: 1, updatedAt });
    const stored = this.sections as Record<SettingsSection, Versioned<unknown> | undefined>;
    for (const name of Object.keys(sections) as SettingsSection[]) stored[name] ??= record(sections[name]);
    for (const world of worlds) {
      if (this.seededWorlds.has(world.id)) continue;
      this.seededWorlds.add(world.id);
      if (!this.worlds.has(world.id)) this.worlds.set(world.id, record(world));
    }
  }

  async saveSection<S extends SettingsSection>(section: S, value: SectionValue<S>, expectedVersion: number): Promise<Versioned<SectionValue<S>>> {
    const current = this.sections[section] as Versioned<SectionValue<S>> | undefined;
    if (!current) throw new RecordNotFoundError(`Settings section ${section} has not been seeded`);
    if (current.version !== expectedVersion) throw new VersionConflictError(current.version);
    const next: Versioned<SectionValue<S>> = { value: structuredClone(value), version: current.version + 1, updatedAt: this.now().toISOString() };
    (this.sections as Record<SettingsSection, Versioned<unknown>>)[section] = next;
    return structuredClone(next);
  }

  async listWorlds(): Promise<Versioned<World>[]> {
    return structuredClone([...this.worlds.values()]);
  }

  async createWorld(world: World): Promise<Versioned<World>> {
    const existing = this.worlds.get(world.id);
    if (existing) throw new VersionConflictError(existing.version);
    const record: Versioned<World> = { value: structuredClone(world), version: 1, updatedAt: this.now().toISOString() };
    this.worlds.set(world.id, record);
    return structuredClone(record);
  }

  async updateWorld(world: World, expectedVersion: number): Promise<Versioned<World>> {
    const current = this.worlds.get(world.id);
    if (!current) throw new RecordNotFoundError(`No world ${world.id}`);
    if (current.version !== expectedVersion) throw new VersionConflictError(current.version);
    const record: Versioned<World> = { value: structuredClone(world), version: current.version + 1, updatedAt: this.now().toISOString() };
    this.worlds.set(world.id, record);
    return structuredClone(record);
  }

  async deleteWorld(id: string, expectedVersion: number): Promise<void> {
    const current = this.worlds.get(id);
    if (!current) throw new RecordNotFoundError(`No world ${id}`);
    if (current.version !== expectedVersion) throw new VersionConflictError(current.version);
    this.worlds.delete(id);
  }
}
