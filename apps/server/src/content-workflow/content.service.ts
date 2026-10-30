import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ALL_QUESTIONS, CONTENT_REFERENCES, CONTENT_TEXT, ContentKind, type QuestionPoolDto, type QuestionStatusSchema, type Versioned } from '@volleyland/contracts';
import type { z } from 'zod';
import { OperationError, type OperationIssue, issuesOf } from '../operations/operation.js';
import { AUTHORING_SCHEMAS, type AnyContentValue, type AuthoredQuestion, type ContentSet, type ContentValue } from './authored-question.js';
import { CONTENT_STORE, type ContentStore, RecordNotFoundError, VersionConflictError } from './content-store.js';
import { referenceOf } from './in-memory-content-store.js';
import { CONTENT_SEED } from './seed.js';

export type QuestionPool = QuestionPoolDto;

/** What the settings service asks of the question bank when an admin changes the questions rooms or a world ask. */
export interface QuestionPoolCheck {
  /** Why a pool cannot be used (unknown curricula, levels or subjects, or no published question in it); empty when it can. */
  checkPool(pool: QuestionPool): OperationIssue[];
}

export const QUESTION_POOL_CHECK = Symbol('QUESTION_POOL_CHECK');

/** Narrows the question list (list_questions). Every field is optional; text matches prompt and options. */
export interface QuestionFilter {
  countryId?: string;
  curriculumId?: string;
  levelId?: string;
  subjectId?: string;
  topicId?: string;
  sourceId?: string;
  status?: z.infer<typeof QuestionStatusSchema>;
  text?: string;
}

/** Where a question sits in the taxonomy. */
export interface QuestionPlace {
  topicId: string;
  subjectId: string;
  levelId: string;
  curriculumId: string;
  countryId: string;
}

export interface QuestionCounts {
  draft: number;
  published: number;
  retired: number;
}

/** A level and what the bank holds for it, subject by subject (get_question_bank_overview). */
export interface LevelOverview {
  countryId: string;
  curriculumId: string;
  levelId: string;
  name: string;
  subjects: { subjectId: string; topics: number; questions: QuestionCounts }[];
}

/** A rejected import: the issues, with paths starting at the question's position in the batch. */
export interface ImportResult {
  dryRun: boolean;
  valid: boolean;
  issues: OperationIssue[];
  /** IDs created (or that would be). */
  ids: string[];
}

type Table = Map<string, Versioned<AnyContentValue>>;

const noun = (kind: ContentKind) => CONTENT_TEXT[kind].singular;

/**
 * The question bank: curriculum taxonomy, sources and questions. Reads are synchronous, from a
 * cache loaded at startup and refreshed after every write, so a hit never waits on storage.
 * Every write is validated (contracts schemas, plus the answer key for questions), its references
 * must exist, and it is saved through the ContentStore with the version the caller last saw.
 * Refusals are OperationError, which the content operations pass on to REST and MCP as is.
 *
 * Matches read published questions through pool(): a question published, edited or retired here is
 * asked (or not) from the next hit on, with no restart.
 */
@Injectable()
export class ContentService implements OnModuleInit, QuestionPoolCheck {
  private readonly logger = new Logger(ContentService.name);
  private readonly tables = new Map<ContentKind, Table>(ContentKind.options.map((kind) => [kind, new Map()]));
  private loaded = false;
  private revisionNumber = 0;
  private readonly pools = new Map<string, readonly AuthoredQuestion[]>();
  private readonly warnedPools = new Set<string>();

  constructor(
    @Inject(CONTENT_STORE) private readonly store: ContentStore,
    @Inject(CONTENT_SEED) private readonly seed: ContentSet,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.load();
  }

  /** Seed what this store has never been offered, then cache what is stored. */
  async load(): Promise<void> {
    await this.store.seed(this.seed);
    const records = await this.store.load();
    for (const kind of ContentKind.options) this.tables.set(kind, new Map(records[kind].map((r) => [r.value.id, r as Versioned<AnyContentValue>])));
    for (const kind of ContentKind.options) {
      for (const { value } of this.table(kind).values()) {
        const missing = this.missingReferences(kind, value);
        if (missing.length > 0) throw new Error(`Stored question bank is inconsistent: ${noun(kind)} "${value.id}" ${missing[0]!.path} ${missing[0]!.message}`);
      }
    }
    if (this.publishedCount() === 0) throw new Error('Stored question bank has no published question: rooms would have nothing to ask');
    this.loaded = true;
    this.changed();
    const counts = ContentKind.options.map((kind) => `${this.table(kind).size} ${kind}`).join(', ');
    this.logger.log(`Question bank loaded: ${counts}`);
  }

  /** Bumped by every saved change. */
  get revision(): number {
    return this.revisionNumber;
  }

  list<K extends ContentKind>(kind: K): Versioned<ContentValue<K>>[] {
    const records = [...this.table(kind).values()] as Versioned<ContentValue<K>>[];
    return structuredClone(records.sort((a, b) => this.compare(kind, a.value, b.value)));
  }

  get<K extends ContentKind>(kind: K, id: string): Versioned<ContentValue<K>> | null {
    const record = this.table(kind).get(id);
    return record ? (structuredClone(record) as Versioned<ContentValue<K>>) : null;
  }

  /** Questions matching a filter, by ID. */
  findQuestions(filter: QuestionFilter): Versioned<AuthoredQuestion>[] {
    const text = filter.text?.trim().toLowerCase();
    return this.list('questions').filter(({ value: q }) => {
      const place = this.placeOf(q);
      if (filter.topicId && q.topicId !== filter.topicId) return false;
      if (filter.subjectId && place?.subjectId !== filter.subjectId) return false;
      if (filter.levelId && place?.levelId !== filter.levelId) return false;
      if (filter.curriculumId && place?.curriculumId !== filter.curriculumId) return false;
      if (filter.countryId && place?.countryId !== filter.countryId) return false;
      if (filter.sourceId && q.source.sourceId !== filter.sourceId) return false;
      if (filter.status && q.status !== filter.status) return false;
      if (text && ![q.id, q.prompt, ...q.options.map((o) => o.text)].some((s) => s.toLowerCase().includes(text))) return false;
      return true;
    });
  }

  /** The topic, subject, level, curriculum and country a question belongs to. */
  placeOf(question: Pick<AuthoredQuestion, 'topicId'>): QuestionPlace | null {
    const topic = this.table('topics').get(question.topicId)?.value as ContentValue<'topics'> | undefined;
    const level = topic && (this.table('levels').get(topic.levelId)?.value as ContentValue<'levels'> | undefined);
    const curriculum = level && (this.table('curricula').get(level.curriculumId)?.value as ContentValue<'curricula'> | undefined);
    if (!topic || !level || !curriculum) return null;
    return { topicId: topic.id, subjectId: topic.subjectId, levelId: level.id, curriculumId: curriculum.id, countryId: curriculum.countryId };
  }

  /** Every level with its subjects' topic and question counts: where the bank is thin. */
  overview(): LevelOverview[] {
    const topics = this.list('topics').map((r) => r.value);
    const questions = this.list('questions').map((r) => r.value);
    return this.list('levels').map(({ value: level }) => {
      const curriculum = this.table('curricula').get(level.curriculumId)!.value as ContentValue<'curricula'>;
      const levelTopics = topics.filter((t) => t.levelId === level.id);
      const subjectIds = [...new Set(levelTopics.map((t) => t.subjectId))].sort();
      return {
        countryId: curriculum.countryId,
        curriculumId: curriculum.id,
        levelId: level.id,
        name: `${curriculum.name} ${level.name}`,
        subjects: subjectIds.map((subjectId) => {
          const topicIds = new Set(levelTopics.filter((t) => t.subjectId === subjectId).map((t) => t.id));
          const counts: QuestionCounts = { draft: 0, published: 0, retired: 0 };
          for (const q of questions) if (topicIds.has(q.topicId)) counts[q.status] += 1;
          return { subjectId, topics: topicIds.size, questions: counts };
        }),
      };
    });
  }

  async create<K extends ContentKind>(kind: K, raw: unknown): Promise<Versioned<ContentValue<K>>> {
    const value = this.parse(kind, raw);
    if (this.table(kind).has(value.id)) throw this.idTaken(kind, value.id);
    this.requireReferences(kind, value);
    const saved = await this.write(() => this.store.create(kind, value));
    this.table(kind).set(value.id, saved as Versioned<AnyContentValue>);
    this.logger.log(`Created ${noun(kind)} ${value.id}`);
    this.changed();
    return saved;
  }

  /** Create many questions at once, all or nothing; dryRun checks without saving. */
  async importQuestions(raws: readonly unknown[], dryRun: boolean): Promise<ImportResult> {
    const issues: OperationIssue[] = [];
    const values: AuthoredQuestion[] = [];
    const ids = new Set<string>();
    raws.forEach((raw, index) => {
      const parsed = AUTHORING_SCHEMAS.questions.safeParse(raw);
      if (!parsed.success) {
        issues.push(...issuesOf(parsed.error, [index]));
        return;
      }
      const question = parsed.data;
      if (this.table('questions').has(question.id) || ids.has(question.id)) issues.push({ path: `${index}.id`, message: `question "${question.id}" already exists` });
      issues.push(...this.missingReferences('questions', question).map((i) => ({ ...i, path: `${index}.${i.path}` })));
      ids.add(question.id);
      values.push(question);
    });
    const result: ImportResult = { dryRun, valid: issues.length === 0, issues, ids: values.map((q) => q.id) };
    if (dryRun) return result;
    if (issues.length > 0) throw new OperationError('invalid', `${new Set(issues.map((i) => i.path.split('.')[0])).size} of ${raws.length} questions cannot be imported; nothing was saved`, issues);
    const saved = await this.write(() => this.store.createMany('questions', values));
    for (const record of saved) this.table('questions').set(record.value.id, record);
    this.logger.log(`Imported ${saved.length} questions`);
    this.changed();
    return result;
  }

  async update<K extends ContentKind>(kind: K, raw: unknown, expectedVersion: number): Promise<Versioned<ContentValue<K>>> {
    const value = this.parse(kind, raw);
    const current = this.table(kind).get(value.id);
    if (!current) throw new OperationError('not_found', `No ${noun(kind)} "${value.id}"`);
    this.requireReferences(kind, value);
    if (kind === 'questions') this.keepOnePublished(value.id, (value as AuthoredQuestion).status);
    const saved = await this.write(() => this.store.update(kind, value, expectedVersion));
    this.table(kind).set(value.id, saved as Versioned<AnyContentValue>);
    this.logger.log(`Updated ${noun(kind)} ${value.id} to v${saved.version}`);
    this.changed();
    return saved;
  }

  async delete(kind: ContentKind, id: string, expectedVersion: number): Promise<void> {
    if (!this.table(kind).has(id)) throw new OperationError('not_found', `No ${noun(kind)} "${id}"`);
    const users = this.usersOf(kind, id);
    if (users.length > 0) {
      const named = users.map(({ kind: k, ids }) => `${ids.length} ${ids.length === 1 ? noun(k) : CONTENT_TEXT[k].title.toLowerCase()} (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '…' : ''})`);
      throw new OperationError('invalid', `This ${noun(kind)} is still used by ${named.join(' and ')}. Delete or move those first.`);
    }
    if (kind === 'questions') this.keepOnePublished(id, null);
    await this.write(() => this.store.delete(kind, id, expectedVersion));
    this.table(kind).delete(id);
    this.logger.log(`Deleted ${noun(kind)} ${id}`);
    this.changed();
  }

  /**
   * The published questions a match with this pool asks, by ID. If the pool no longer matches any
   * (its questions were retired since it was saved), rooms fall back to every published question
   * rather than stall, and the server logs it.
   */
  pool(pool: QuestionPool): readonly AuthoredQuestion[] {
    const key = JSON.stringify(pool);
    const cached = this.pools.get(key);
    if (cached) return cached;
    let questions = this.matching(pool);
    if (questions.length === 0) {
      if (!this.warnedPools.has(key)) this.logger.warn(`No published question matches the question pool ${key}; asking from the whole bank instead`);
      this.warnedPools.add(key);
      questions = this.matching(ALL_QUESTIONS);
    }
    const frozen = Object.freeze(questions);
    this.pools.set(key, frozen);
    return frozen;
  }

  /** How many published questions a pool matches (no fallback). */
  poolSize(pool: QuestionPool): number {
    return this.matching(pool).length;
  }

  checkPool(pool: QuestionPool): OperationIssue[] {
    const issues: OperationIssue[] = [];
    pool.curriculumIds.forEach((id, i) => {
      if (!this.table('curricula').has(id)) issues.push({ path: `curriculumIds.${i}`, message: `no curriculum "${id}"` });
    });
    pool.levelIds.forEach((id, i) => {
      if (!this.table('levels').has(id)) issues.push({ path: `levelIds.${i}`, message: `no level "${id}"` });
    });
    pool.subjectIds.forEach((id, i) => {
      if (!this.table('subjects').has(id)) issues.push({ path: `subjectIds.${i}`, message: `no subject "${id}"` });
    });
    if (issues.length === 0 && this.poolSize(pool) === 0) {
      issues.push({ path: 'levelIds', message: 'no published question matches these question banks, levels, subjects and difficulty' });
    }
    return issues;
  }

  private matching(pool: QuestionPool): AuthoredQuestion[] {
    this.requireLoaded();
    const curricula = new Set(pool.curriculumIds);
    const levels = new Set(pool.levelIds);
    const subjects = new Set(pool.subjectIds);
    const [min, max] = pool.difficulty;
    return this.list('questions')
      .map((r) => r.value)
      .filter((q) => {
        if (q.status !== 'published' || q.difficulty < min || q.difficulty > max) return false;
        const place = this.placeOf(q);
        return (
          !!place &&
          (curricula.size === 0 || curricula.has(place.curriculumId)) &&
          (levels.size === 0 || levels.has(place.levelId)) &&
          (subjects.size === 0 || subjects.has(place.subjectId))
        );
      });
  }

  private publishedCount(): number {
    let count = 0;
    for (const { value } of this.table('questions').values()) if ((value as AuthoredQuestion).status === 'published') count += 1;
    return count;
  }

  /** Refuse a change that would leave no published question: matches need something to ask. */
  private keepOnePublished(id: string, nextStatus: AuthoredQuestion['status'] | null): void {
    const current = this.table('questions').get(id)?.value as AuthoredQuestion | undefined;
    if (current?.status === 'published' && nextStatus !== 'published' && this.publishedCount() === 1) {
      throw new OperationError('invalid', 'This is the last published question; publish another first. Matches always need something to ask.');
    }
  }

  private parse<K extends ContentKind>(kind: K, raw: unknown): ContentValue<K> {
    const parsed = AUTHORING_SCHEMAS[kind].safeParse(raw);
    if (!parsed.success) throw new OperationError('invalid', `Invalid ${noun(kind)}`, issuesOf(parsed.error));
    return parsed.data as ContentValue<K>;
  }

  private missingReferences(kind: ContentKind, value: unknown): OperationIssue[] {
    return CONTENT_REFERENCES[kind].flatMap((ref) => {
      const target = referenceOf(value, ref.field);
      return target && this.table(ref.kind).has(target) ? [] : [{ path: ref.field, message: `no ${noun(ref.kind)} "${target}"` }];
    });
  }

  private requireReferences(kind: ContentKind, value: unknown): void {
    const issues = this.missingReferences(kind, value);
    if (issues.length > 0) throw new OperationError('invalid', `This ${noun(kind)} refers to records that do not exist`, issues);
  }

  /** Records of other kinds that refer to this one. */
  private usersOf(kind: ContentKind, id: string): { kind: ContentKind; ids: string[] }[] {
    return ContentKind.options.flatMap((other) => {
      const fields = CONTENT_REFERENCES[other].filter((ref) => ref.kind === kind).map((ref) => ref.field);
      if (fields.length === 0) return [];
      const ids = [...this.table(other).values()].filter(({ value }) => fields.some((f) => referenceOf(value, f) === id)).map(({ value }) => value.id);
      return ids.length > 0 ? [{ kind: other, ids: ids.sort() }] : [];
    });
  }

  private idTaken(kind: ContentKind, id: string): OperationError {
    return new OperationError('conflict', `A ${noun(kind)} with ID "${id}" already exists`, [{ path: 'id', message: 'already taken' }]);
  }

  /** Sort order for lists: by name where there is one, levels by their order, questions by ID. */
  private compare(kind: ContentKind, a: AnyContentValue, b: AnyContentValue): number {
    const label = (v: AnyContentValue): string => {
      if (kind === 'levels') {
        const level = v as ContentValue<'levels'>;
        return `${level.curriculumId}\u0000${String(level.order).padStart(3, '0')}`;
      }
      if (kind === 'topics') {
        const topic = v as ContentValue<'topics'>;
        return `${topic.levelId}\u0000${topic.subjectId}\u0000${topic.name}`;
      }
      if (kind === 'sources') return (v as ContentValue<'sources'>).title;
      if (kind === 'questions') return v.id;
      return (v as { name: string }).name;
    };
    return label(a).localeCompare(label(b)) || a.id.localeCompare(b.id);
  }

  private changed(): void {
    this.revisionNumber += 1;
    this.pools.clear();
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

  private table(kind: ContentKind): Table {
    return this.tables.get(kind)!;
  }

  private requireLoaded(): void {
    if (!this.loaded) throw new Error('ContentService used before load()');
  }
}
