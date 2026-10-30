import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ContentKind, type Versioned } from '@volleyland/contracts';
import { AUTHORING_SCHEMAS, type ContentSet, type ContentValue } from './authored-question.js';
import type { ContentRecords, ContentStore } from './content-store.js';
import { type ContentState, InMemoryContentStore, emptyContentRecords } from './in-memory-content-store.js';

/** Bump when the file layout changes, and migrate older files on load. */
const FILE_FORMAT = 1;

interface ContentFile extends ContentState {
  format: number;
}

/**
 * Phase 0 persistence for the question bank: one JSON file (QUESTIONS_FILE, default
 * data/questions.json, next to the settings file on the server's data volume). It keeps the
 * working copy in an InMemoryContentStore and rewrites the whole file after each change,
 * atomically and one write at a time. A Postgres store replaces it.
 *
 * The file is validated on load with the same schemas as admin writes, so a hand-edited mistake
 * stops the server at startup instead of reaching a match.
 */
export class JsonFileContentStore implements ContentStore {
  private readonly memory: InMemoryContentStore;
  private loaded: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    readonly filePath: string,
    now: () => Date = () => new Date(),
  ) {
    this.memory = new InMemoryContentStore(now);
  }

  async load(): Promise<ContentRecords> {
    await this.ensureLoaded();
    return this.memory.load();
  }

  async seed(seed: ContentSet): Promise<void> {
    await this.ensureLoaded();
    const before = JSON.stringify(this.memory.snapshot());
    await this.memory.seed(seed);
    if (JSON.stringify(this.memory.snapshot()) !== before) await this.persist();
  }

  create<K extends ContentKind>(kind: K, value: ContentValue<K>): Promise<Versioned<ContentValue<K>>> {
    return this.change(() => this.memory.create(kind, value));
  }

  createMany<K extends ContentKind>(kind: K, values: readonly ContentValue<K>[]): Promise<Versioned<ContentValue<K>>[]> {
    return this.change(() => this.memory.createMany(kind, values));
  }

  update<K extends ContentKind>(kind: K, value: ContentValue<K>, expectedVersion: number): Promise<Versioned<ContentValue<K>>> {
    return this.change(() => this.memory.update(kind, value, expectedVersion));
  }

  delete(kind: ContentKind, id: string, expectedVersion: number): Promise<void> {
    return this.change(() => this.memory.delete(kind, id, expectedVersion));
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
    this.memory.restore(parseContentFile(text, this.filePath));
  }

  private persist(): Promise<void> {
    const file: ContentFile = { format: FILE_FORMAT, ...this.memory.snapshot() };
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

export function parseContentFile(text: string, source = 'question bank file'): ContentState {
  const fail = (message: string): never => {
    throw new Error(`Invalid ${source}: ${message}`);
  };
  let file: Partial<ContentFile>;
  try {
    file = JSON.parse(text) as Partial<ContentFile>;
  } catch (error) {
    return fail(`not JSON (${(error as Error).message})`);
  }
  if (file.format !== FILE_FORMAT) fail(`unsupported format ${String(file.format)} (expected ${FILE_FORMAT})`);
  const records = emptyContentRecords();
  for (const kind of ContentKind.options) {
    const stored: unknown = file.records?.[kind] ?? [];
    if (!Array.isArray(stored)) return fail(`records.${kind} must be an array`);
    for (const record of stored as Versioned<unknown>[]) {
      const result = AUTHORING_SCHEMAS[kind].safeParse(record?.value);
      if (!result.success) fail(`${kind} ${String((record?.value as { id?: unknown })?.id)}: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      if (!Number.isInteger(record.version) || record.version < 1 || typeof record.updatedAt !== 'string') fail(`${kind} ${String(result.data?.id)}: bad version or updatedAt`);
    }
    (records as Record<ContentKind, unknown[]>)[kind] = stored;
  }
  const seeded = Array.isArray(file.seeded) && file.seeded.every((key) => typeof key === 'string') ? file.seeded : fail('seeded must be a list of kind:id keys');
  return { records, seeded };
}
