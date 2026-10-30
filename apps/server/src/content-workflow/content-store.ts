import type { ContentKind, Versioned } from '@volleyland/contracts';
import type { ContentSet, ContentValue } from './authored-question.js';

export { RecordNotFoundError, VersionConflictError } from '../settings/settings-store.js';

export const CONTENT_STORE = Symbol('CONTENT_STORE');

export type ContentRecords = { [K in ContentKind]: Versioned<ContentValue<K>>[] };

/**
 * Persistence boundary for the question bank: the curriculum taxonomy, sources and questions.
 * Phase 0 keeps them in a JSON file (JsonFileContentStore); a Postgres store (one table per kind,
 * references as foreign keys) replaces it without touching callers.
 *
 * Like SettingsStore: async, one versioned record per row, and every write names the version it
 * replaces. Values arrive already validated by ContentService; the store only keeps them.
 */
export interface ContentStore {
  /** Every stored record of every kind. */
  load(): Promise<ContentRecords>;
  /**
   * Insert every seed record this store has never been offered (tracked by kind and ID, so a
   * seeded record an admin deleted stays deleted and one they edited keeps their edits). A seed
   * record whose references no longer exist is skipped. Called on every start: the job a data
   * migration that inserts default rows would do.
   */
  seed(seed: ContentSet): Promise<void>;
  /** Throws VersionConflictError if a record of that kind and ID exists. */
  create<K extends ContentKind>(kind: K, value: ContentValue<K>): Promise<Versioned<ContentValue<K>>>;
  /** All or nothing: one transaction once this is a database. */
  createMany<K extends ContentKind>(kind: K, values: readonly ContentValue<K>[]): Promise<Versioned<ContentValue<K>>[]>;
  update<K extends ContentKind>(kind: K, value: ContentValue<K>, expectedVersion: number): Promise<Versioned<ContentValue<K>>>;
  delete(kind: ContentKind, id: string, expectedVersion: number): Promise<void>;
}
