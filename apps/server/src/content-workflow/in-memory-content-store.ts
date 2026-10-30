import { CONTENT_REFERENCES, ContentKind, type Versioned } from '@volleyland/contracts';
import { type ContentSet, type ContentValue, KINDS_IN_DEPENDENCY_ORDER } from './authored-question.js';
import { type ContentRecords, type ContentStore, RecordNotFoundError, VersionConflictError } from './content-store.js';

/** Everything a content store holds, as plain JSON (what the file store writes to disk). */
export interface ContentState {
  records: ContentRecords;
  /** `kind:id` of every seed record already offered to this store, whether or not it still exists. */
  seeded: string[];
}

/** The value a reference field holds (`source.sourceId` reads a nested field). */
export function referenceOf(value: unknown, field: string): string | undefined {
  let current: unknown = value;
  for (const key of field.split('.')) current = typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[key] : undefined;
  return typeof current === 'string' ? current : undefined;
}

export const emptyContentRecords = (): ContentRecords =>
  Object.fromEntries(ContentKind.options.map((kind) => [kind, []])) as unknown as ContentRecords;

/**
 * The question bank in process memory: the working copy behind JsonFileContentStore, and the
 * store tests use. Values are deep-copied in and out, as a database round trip would.
 */
export class InMemoryContentStore implements ContentStore {
  private readonly records = new Map<ContentKind, Map<string, Versioned<ContentValue<ContentKind>>>>(ContentKind.options.map((kind) => [kind, new Map()]));
  private readonly seeded = new Set<string>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  snapshot(): ContentState {
    const records = Object.fromEntries(ContentKind.options.map((kind) => [kind, [...this.table(kind).values()]])) as unknown as ContentRecords;
    return structuredClone({ records, seeded: [...this.seeded] });
  }

  restore(state: ContentState): void {
    for (const kind of ContentKind.options) {
      const table = this.table(kind);
      table.clear();
      for (const record of state.records[kind] ?? []) table.set(record.value.id, structuredClone(record));
    }
    this.seeded.clear();
    for (const key of state.seeded) this.seeded.add(key);
  }

  async load(): Promise<ContentRecords> {
    return this.snapshot().records;
  }

  async seed(seed: ContentSet): Promise<void> {
    const updatedAt = this.now().toISOString();
    for (const kind of KINDS_IN_DEPENDENCY_ORDER) {
      const table = this.table(kind);
      for (const value of seed[kind]) {
        const key = `${kind}:${value.id}`;
        if (this.seeded.has(key)) continue;
        this.seeded.add(key);
        if (table.has(value.id)) continue;
        // A parent an admin deleted takes its seeded children with it, as a foreign key would.
        const orphan = CONTENT_REFERENCES[kind].some((ref) => !this.table(ref.kind).has(referenceOf(value, ref.field) ?? ''));
        if (!orphan) table.set(value.id, { value: structuredClone(value), version: 1, updatedAt });
      }
    }
  }

  async create<K extends ContentKind>(kind: K, value: ContentValue<K>): Promise<Versioned<ContentValue<K>>> {
    const [record] = await this.createMany(kind, [value]);
    return record!;
  }

  async createMany<K extends ContentKind>(kind: K, values: readonly ContentValue<K>[]): Promise<Versioned<ContentValue<K>>[]> {
    const table = this.table(kind);
    for (const value of values) {
      const existing = table.get(value.id);
      if (existing) throw new VersionConflictError(existing.version);
    }
    const updatedAt = this.now().toISOString();
    const records = values.map((value) => ({ value: structuredClone(value), version: 1, updatedAt }));
    for (const record of records) table.set(record.value.id, record);
    return structuredClone(records);
  }

  async update<K extends ContentKind>(kind: K, value: ContentValue<K>, expectedVersion: number): Promise<Versioned<ContentValue<K>>> {
    const table = this.table(kind);
    const current = table.get(value.id);
    if (!current) throw new RecordNotFoundError(`No ${kind} record "${value.id}"`);
    if (current.version !== expectedVersion) throw new VersionConflictError(current.version);
    const record = { value: structuredClone(value), version: current.version + 1, updatedAt: this.now().toISOString() };
    table.set(value.id, record);
    return structuredClone(record);
  }

  async delete(kind: ContentKind, id: string, expectedVersion: number): Promise<void> {
    const table = this.table(kind);
    const current = table.get(id);
    if (!current) throw new RecordNotFoundError(`No ${kind} record "${id}"`);
    if (current.version !== expectedVersion) throw new VersionConflictError(current.version);
    table.delete(id);
  }

  private table<K extends ContentKind>(kind: K): Map<string, Versioned<ContentValue<K>>> {
    return this.records.get(kind) as Map<string, Versioned<ContentValue<K>>>;
  }
}
