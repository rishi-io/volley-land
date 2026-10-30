import type { SectionValue, SectionValues, SettingsSection, Versioned } from '@volleyland/contracts';
import type { World } from '@volleyland/game-core';

export const SETTINGS_STORE = Symbol('SETTINGS_STORE');

export type StoredSections = { [S in SettingsSection]: Versioned<SectionValue<S>> };

/** A write named a version that is no longer current (someone else saved first). */
export class VersionConflictError extends Error {
  constructor(readonly current: number) {
    super(`Stale version: the current version is ${current}`);
  }
}

export class RecordNotFoundError extends Error {}

/**
 * Persistence boundary for admin-managed settings and worlds. Phase 0 keeps them in a JSON file
 * (JsonFileSettingsStore); a database-backed store replaces it without touching callers.
 *
 * Shaped for that database: every method is async, each section and each world is its own
 * record with a version, and every write names the version it replaces (optimistic concurrency).
 * Values are plain JSON that the schemas in @volleyland/contracts validate before they get here.
 */
export interface SettingsStore {
  /** The stored sections; empty on first boot, and missing any section added since the last seed. */
  loadSections(): Promise<Partial<StoredSections>>;
  /**
   * Store every section that is missing (at version 1), and every seed world this store has never
   * been seeded with (tracked by ID, so a built-in world an admin deleted stays deleted, and one
   * they edited keeps their edits). Called on every start, so a newly added section or built-in
   * world arrives without touching the rest: the same job a database migration that inserts
   * default rows would do.
   */
  seed(sections: SectionValues, worlds: readonly World[]): Promise<void>;
  saveSection<S extends SettingsSection>(section: S, value: SectionValue<S>, expectedVersion: number): Promise<Versioned<SectionValue<S>>>;

  listWorlds(): Promise<Versioned<World>[]>;
  /** Throws VersionConflictError if a world with that ID exists. */
  createWorld(world: World): Promise<Versioned<World>>;
  updateWorld(world: World, expectedVersion: number): Promise<Versioned<World>>;
  deleteWorld(id: string, expectedVersion: number): Promise<void>;
}
