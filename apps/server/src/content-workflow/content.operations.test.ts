import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALL_QUESTIONS, ContentKind } from '@volleyland/contracts';
import { BUILTIN_WORLDS, PROTOTYPE_WORLD } from '@volleyland/game-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationAuditLog } from '../operations/operation-audit.js';
import { OperationRunner } from '../operations/operation-runner.service.js';
import { type Actor, type AnyOperation, OperationError } from '../operations/operation.js';
import { QuestionHistory } from '../question-selection/question-history.js';
import { QuestionSelectionService } from '../question-selection/question-selection.service.js';
import { DEFAULT_SEED } from '../settings/defaults.js';
import { InMemorySettingsStore } from '../settings/in-memory-settings-store.js';
import { SettingsOperations } from '../settings/settings.operations.js';
import { SettingsService, questionPoolOf } from '../settings/settings.service.js';
import { ANSWER_KEY_FIELDS, type AuthoredQuestion, type ContentSet } from './authored-question.js';
import { ContentOperations } from './content.operations.js';
import type { ContentService } from './content.service.js';
import { InMemoryContentStore } from './in-memory-content-store.js';
import { JsonFileContentStore, parseContentFile } from './json-file-content-store.js';
import { DEFAULT_CONTENT_SEED, loadSeedContent, seedQuestions } from './seed.js';
import { contentServiceWith } from './testing.js';

const writer: Actor = { requestId: 'r1', principal: { kind: 'admin-token' }, access: 'write', via: 'rest', userAgent: null };
const reader: Actor = { ...writer, access: 'read', via: 'mcp' };

const question = (id: string, overrides: Partial<AuthoredQuestion> = {}): AuthoredQuestion => ({
  id,
  topicId: 'xx-algebra',
  difficulty: 2,
  status: 'published',
  prompt: `Question ${id}?`,
  options: [
    { id: 'a', text: 'One' },
    { id: 'b', text: 'Two' },
  ],
  correctOptionId: 'b',
  explanation: 'Because two.',
  source: { sourceId: 'xx-book', use: 'copied', reference: 'Page 1' },
  ...overrides,
});

/** A small bank: one country, curriculum, level, subject, topic and source, and two published questions. */
const TINY: ContentSet = {
  countries: [{ id: 'xx', name: 'Testland' }],
  curricula: [{ id: 'xx-board', countryId: 'xx', name: 'Test Board', description: '' }],
  levels: [{ id: 'xx-grade-9', curriculumId: 'xx-board', name: 'Grade 9', order: 9, ages: [14, 15], description: '' }],
  subjects: [{ id: 'maths', name: 'Maths', description: '' }],
  topics: [{ id: 'xx-algebra', levelId: 'xx-grade-9', subjectId: 'maths', name: 'Algebra', description: '' }],
  sources: [{ id: 'xx-book', title: 'Test Book', publisher: 'Test Press', url: 'https://example.com/book', year: 2024, licence: 'CC BY 4.0', notes: '' }],
  questions: [question('q-1'), question('q-2', { difficulty: 4 })],
};

afterEach(() => vi.restoreAllMocks());

async function setup(seed: ContentSet = TINY) {
  const content = await contentServiceWith(seed);
  const audit = new OperationAuditLog();
  vi.spyOn(audit, 'call').mockImplementation(() => {});
  const runner = new OperationRunner({ timeoutMs: 5_000 }, audit);
  const ops = new ContentOperations(content);
  const run = <T>(op: AnyOperation, input: unknown, actor = writer) => runner.run(op, input, actor) as Promise<T>;
  return { content, ops, run };
}

const refusal = async (promise: Promise<unknown>): Promise<OperationError> => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(OperationError);
  return error as OperationError;
};

describe('question bank seed', () => {
  it('covers India CBSE Class 10 and UK GCSE Year 11, every question published, original and attributed', () => {
    const seed = loadSeedContent();
    expect(seed.countries.map((c) => c.id).sort()).toEqual(['gb', 'in']);
    expect(seed.levels.map((l) => l.id).sort()).toEqual(['gb-gcse-year-11', 'in-cbse-class-10']);
    for (const level of seed.levels) {
      const topics = new Set(seed.topics.filter((t) => t.levelId === level.id).map((t) => t.id));
      expect(seed.questions.filter((q) => topics.has(q.topicId)).length, level.id).toBeGreaterThanOrEqual(30);
    }
    for (const q of seed.questions) {
      expect(q.status, q.id).toBe('published');
      expect(q.source.use, q.id).toBe('aligned'); // written for the bank, never copied from copyrighted papers
      expect(q.source.reference.length, q.id).toBeGreaterThan(0);
      expect(q.options.length, q.id).toBe(4);
      expect(q.explanation.length, q.id).toBeGreaterThan(0);
    }
    for (const source of seed.sources) expect(source.licence.length, source.id).toBeGreaterThan(0);
  });

  it('reaches a store once per record: a seeded record an admin deleted stays deleted', async () => {
    const store = new InMemoryContentStore();
    const content = await contentServiceWith(TINY, store);
    await content.delete('questions', 'q-2', 1);
    await store.seed(TINY);
    expect((await store.load()).questions.map((r) => r.value.id)).toEqual(['q-1']);
  });

  it('skips a new seed record whose parent an admin deleted', async () => {
    const store = new InMemoryContentStore();
    await store.seed({ ...TINY, questions: [], topics: [] });
    await store.delete('sources', 'xx-book', 1);
    await store.seed(TINY);
    const records = await store.load();
    expect(records.topics).toHaveLength(1);
    expect(records.questions).toEqual([]); // their source is gone
  });
});

describe('content operations', () => {
  it('cover the question bank CMS under stable names', () => {
    const names = new ContentOperations({} as ContentService).operations().map((o) => o.name);
    const crud = (plural: string, one: string) => [`list_${plural}`, `create_${one}`, `update_${one}`, `delete_${one}`];
    // MCP clients call these by name: change this list on purpose, never by accident.
    expect(names.sort()).toEqual(
      [
        'get_question_bank_overview',
        ...crud('countries', 'country'),
        ...crud('curricula', 'curriculum'),
        ...crud('levels', 'level'),
        ...crud('subjects', 'subject'),
        ...crud('topics', 'topic'),
        ...crud('sources', 'source'),
        ...crud('questions', 'question'),
        'get_question',
        'import_questions',
        'preview_question_pool',
      ].sort(),
    );
  });

  it('creates, updates and deletes every kind of taxonomy record, in dependency order', async () => {
    const { ops, run } = await setup();
    await run(ops.taxonomy('countries').create, { id: 'gb', name: 'United Kingdom' });
    await run(ops.taxonomy('curricula').create, { id: 'gb-scot', countryId: 'gb', name: 'Scottish Nationals', description: '' });
    await run(ops.taxonomy('levels').create, { id: 'gb-scot-s4', curriculumId: 'gb-scot', name: 'S4', order: 4, ages: [15, 16], description: 'National 5' });
    await run(ops.taxonomy('subjects').create, { id: 'history', name: 'History', description: '' });
    await run(ops.taxonomy('topics').create, { id: 'gb-scot-s4-hist-wars', levelId: 'gb-scot-s4', subjectId: 'history', name: 'Wars of Independence', description: '' });
    await run(ops.taxonomy('sources').create, { id: 'sqa-history', title: 'National 5 History', publisher: 'SQA', url: null, year: null, licence: '© SQA', notes: '' });

    const levels = await run<{ value: { id: string } }[]>(ops.taxonomy('levels').list, { curriculumId: 'gb-scot' });
    expect(levels.map((l) => l.value.id)).toEqual(['gb-scot-s4']);

    const renamed = await run<{ version: number; value: { name: string; order: number } }>(ops.taxonomy('levels').update, { id: 'gb-scot-s4', expectedVersion: 1, changes: { name: 'S4 (National 5)' } });
    expect(renamed).toMatchObject({ version: 2, value: { name: 'S4 (National 5)', order: 4 } });

    // Still in use: refused, naming what uses it.
    const inUse = await refusal(run(ops.taxonomy('levels').remove, { id: 'gb-scot-s4', expectedVersion: 2 }));
    expect(inUse).toMatchObject({ kind: 'invalid', message: expect.stringContaining('gb-scot-s4-hist-wars') });
    await run(ops.taxonomy('topics').remove, { id: 'gb-scot-s4-hist-wars', expectedVersion: 1 });
    await run(ops.taxonomy('levels').remove, { id: 'gb-scot-s4', expectedVersion: 2 });
    expect(await run(ops.taxonomy('levels').list, { curriculumId: 'gb-scot' })).toEqual([]);
  });

  it('refuses missing references, taken IDs, stale versions and unknown records', async () => {
    const { ops, run } = await setup();
    const missing = await refusal(run(ops.taxonomy('topics').create, { id: 'xx-geo', levelId: 'xx-grade-9', subjectId: 'geography', name: 'Maps', description: '' }));
    expect(missing).toMatchObject({ kind: 'invalid', issues: [{ path: 'subjectId', message: 'no subject "geography"' }] });
    expect(await refusal(run(ops.taxonomy('countries').create, { id: 'xx', name: 'Again' }))).toMatchObject({ kind: 'conflict' });
    expect(await refusal(run(ops.taxonomy('countries').update, { id: 'xx', expectedVersion: 7, changes: { name: 'Late' } }))).toMatchObject({ kind: 'conflict' });
    expect(await refusal(run(ops.taxonomy('countries').update, { id: 'zz', expectedVersion: 1, changes: { name: 'Nowhere' } }))).toMatchObject({ kind: 'not_found' });
    expect(await refusal(run(ops.taxonomy('countries').create, { id: 'yy', name: 'Y', extra: true }))).toMatchObject({ kind: 'invalid' });
  });

  it('authors questions with their answer key and source, as drafts unless published', async () => {
    const { ops, run, content } = await setup();
    const { id: _id, status: _status, ...fields } = question('unused');
    const created = await run<{ version: number; value: AuthoredQuestion }>(ops.createQuestion, fields);
    expect(created.value).toMatchObject({ status: 'draft', correctOptionId: 'b', source: { sourceId: 'xx-book', use: 'copied' } });
    expect(created.value.id).toMatch(/^q-[0-9a-f]{8}$/);
    expect(content.pool({ curriculumIds: [], levelIds: [], subjectIds: [], difficulty: [1, 5] }).map((q) => q.id)).toEqual(['q-1', 'q-2']);

    const published = await run<{ value: AuthoredQuestion }>(ops.updateQuestion, { id: created.value.id, expectedVersion: 1, changes: { status: 'published' } });
    expect(published.value.status).toBe('published');
    expect(content.pool({ curriculumIds: [], levelIds: [], subjectIds: [], difficulty: [1, 5] })).toHaveLength(3);

    const badKey = await refusal(run(ops.updateQuestion, { id: 'q-1', expectedVersion: 1, changes: { correctOptionId: 'z' } }));
    expect(badKey.issues).toEqual([{ path: 'correctOptionId', message: 'must name one of the options' }]);
    const badSource = await refusal(run(ops.updateQuestion, { id: 'q-1', expectedVersion: 1, changes: { source: { sourceId: 'nope', use: 'adapted', reference: '' } } }));
    expect(badSource.issues).toEqual([{ path: 'source.sourceId', message: 'no source "nope"' }]);
  });

  it('never shows an answer key to a read-only actor', async () => {
    const { ops, run } = await setup();
    const leaks = (output: unknown) => ANSWER_KEY_FIELDS.some((key) => JSON.stringify(output).includes(`"${key}"`)) || JSON.stringify(output).includes('Because two.');
    const readOps: [AnyOperation, unknown][] = [
      [ops.overview, {}],
      [ops.listQuestions, {}],
      [ops.getQuestion, { id: 'q-1' }],
      [ops.previewPool, {}],
      ...ContentKind.options.filter((k) => k !== 'questions').map((k): [AnyOperation, unknown] => [ops.taxonomy(k as Exclude<ContentKind, 'questions'>).list, {}]),
    ];
    for (const [op, input] of readOps) {
      expect(op.access, op.name).toBe('read');
      expect(leaks(await run(op, input, reader)), op.name).toBe(false);
    }
    // Every operation that may show an answer key to a reader is listed above.
    const shown = new ContentOperations({} as ContentService).operations().filter((o) => o.access === 'read');
    expect(shown.map((o) => o.name).sort()).toEqual(readOps.map(([op]) => op.name).sort());
    // Authors see it.
    expect(await run(ops.getQuestion, { id: 'q-1' }, writer)).toMatchObject({ value: { correctOptionId: 'b', explanation: 'Because two.' }, place: { levelId: 'xx-grade-9', countryId: 'xx' } });
  });

  it('refuses every write to a read-only actor', async () => {
    const { ops, run } = await setup();
    for (const op of ops.operations().filter((o) => o.access === 'write')) {
      expect(await refusal(run(op, {}, reader)), op.name).toMatchObject({ kind: 'forbidden' });
    }
  });

  it('filters questions by country, level, subject, status and text', async () => {
    const { ops, run } = await setup(DEFAULT_CONTENT_SEED);
    type Page = { total: number; questions: { value: AuthoredQuestion }[] };
    const india = await run<Page>(ops.listQuestions, { countryId: 'in', limit: 5000 });
    const uk = await run<Page>(ops.listQuestions, { levelId: 'gb-gcse-year-11', limit: 5000 });
    expect(india.total + uk.total).toBe(DEFAULT_CONTENT_SEED.questions.length);
    const maths = await run<Page>(ops.listQuestions, { countryId: 'gb', subjectId: 'mathematics', limit: 2 });
    expect(maths.questions).toHaveLength(2);
    expect(maths.total).toBeGreaterThan(2);
    expect((await run<Page>(ops.listQuestions, { status: 'draft' })).total).toBe(0);
    const word = india.questions[0]!.value.prompt.split(' ').find((w) => w.length > 6)!;
    expect((await run<Page>(ops.listQuestions, { text: word.toUpperCase() })).total).toBeGreaterThan(0);
  });

  it('imports a batch all or nothing, reporting problems by position', async () => {
    const { ops, run, content } = await setup();
    const batch = [question('q-3'), question('q-1'), question('q-4', { topicId: 'xx-nope' })];
    const dry = await run<{ valid: boolean; issues: { path: string }[] }>(ops.importQuestions, { questions: batch, dryRun: true });
    expect(dry.valid).toBe(false);
    expect(dry.issues.map((i) => i.path)).toEqual(['1.id', '2.topicId']);
    expect(await refusal(run(ops.importQuestions, { questions: batch }))).toMatchObject({ kind: 'invalid' });
    expect(content.list('questions')).toHaveLength(2);
    expect(await run(ops.importQuestions, { questions: [question('q-3'), question('q-4')] })).toMatchObject({ valid: true, ids: ['q-3', 'q-4'] });
    expect(content.list('questions')).toHaveLength(4);
  });

  it('keeps at least one question published', async () => {
    const { ops, run } = await setup();
    await run(ops.updateQuestion, { id: 'q-1', expectedVersion: 1, changes: { status: 'retired' } });
    expect(await refusal(run(ops.updateQuestion, { id: 'q-2', expectedVersion: 1, changes: { status: 'draft' } }))).toMatchObject({ kind: 'invalid' });
    expect(await refusal(run(ops.deleteQuestion, { id: 'q-2', expectedVersion: 1 }))).toMatchObject({ kind: 'invalid' });
    await run(ops.deleteQuestion, { id: 'q-1', expectedVersion: 2 });
  });

  it('summarises coverage per level and subject', async () => {
    const { ops, run } = await setup(DEFAULT_CONTENT_SEED);
    const overview = await run<{ levels: { levelId: string; subjects: { subjectId: string; questions: { published: number } }[] }[] }>(ops.overview, {}, reader);
    const india = overview.levels.find((l) => l.levelId === 'in-cbse-class-10')!;
    expect(india.subjects.map((s) => s.subjectId)).toEqual(['mathematics', 'science', 'social-science']);
    expect(india.subjects.every((s) => s.questions.published > 0)).toBe(true);
  });
});

describe('question pools', () => {
  it('asks only published questions in the pool, and falls back to the whole bank when it is empty', async () => {
    const content = await contentServiceWith();
    const india = content.pool({ curriculumIds: [], levelIds: ['in-cbse-class-10'], subjectIds: ['mathematics'], difficulty: [1, 5] });
    expect(india.length).toBeGreaterThan(5);
    for (const q of india) expect(content.placeOf(q)).toMatchObject({ levelId: 'in-cbse-class-10', subjectId: 'mathematics' });
    const hard = content.pool({ curriculumIds: [], levelIds: [], subjectIds: [], difficulty: [5, 5] });
    expect(hard.every((q) => q.difficulty === 5)).toBe(true);

    expect(content.checkPool({ curriculumIds: [], levelIds: ['gb-gcse-year-11'], subjectIds: ['social-science'], difficulty: [1, 5] })).toEqual([
      { path: 'levelIds', message: 'no published question matches these question banks, levels, subjects and difficulty' },
    ]);
    expect(content.checkPool({ curriculumIds: [], levelIds: ['nowhere'], subjectIds: [], difficulty: [1, 5] })).toEqual([{ path: 'levelIds.0', message: 'no level "nowhere"' }]);
    expect(content.pool({ curriculumIds: [], levelIds: ['gb-gcse-year-11'], subjectIds: ['social-science'], difficulty: [1, 5] })).toHaveLength(seedQuestions().length);
  });

  it('lets a match ask from the room pool, picking up CMS changes at the next hit', async () => {
    const content = await contentServiceWith(TINY);
    const selector = new QuestionSelectionService(content).forMatch('m1', { curriculumIds: [], levelIds: [], subjectIds: [], difficulty: [4, 5] }, new QuestionHistory());
    expect(selector.select('p1').questionId).toBe('q-2');
    await content.create('questions', question('q-3', { difficulty: 5 }));
    await content.update('questions', question('q-2', { difficulty: 4, status: 'retired' }), 1);
    expect(selector.select('p1').questionId).toBe('q-3');
  });

  it('is what update_questions_settings checks, and what rooms then ask', async () => {
    const content = await contentServiceWith();
    const settings = new SettingsService(new InMemorySettingsStore(), DEFAULT_SEED, { devRoomCode: 'DEV' }, content);
    await settings.load();
    const audit = new OperationAuditLog();
    vi.spyOn(audit, 'call').mockImplementation(() => {});
    const runner = new OperationRunner({ timeoutMs: 5_000 }, audit);
    const ops = new SettingsOperations(settings);
    const update = (changes: unknown, expectedVersion = 1) => runner.run(ops.updateSection('questions'), { expectedVersion, changes }, writer);

    expect(await refusal(update({ levelIds: ['nowhere'] }))).toMatchObject({ kind: 'invalid', issues: [{ path: 'levelIds.0' }] });
    expect(await update({ levelIds: ['gb-gcse-year-11'], subjectIds: ['physics'] })).toMatchObject({ version: 2 });
    expect(settings.live().questions).toEqual({ curriculumIds: [], levelIds: ['gb-gcse-year-11'], subjectIds: ['physics'], difficulty: [1, 5] });
    // Retiring every question in the stored pool does not stop other sections saving (rooms fall back to the whole bank).
    for (const { value, version } of content.findQuestions({ levelId: 'gb-gcse-year-11', subjectId: 'physics' })) {
      await content.update('questions', { ...value, status: 'retired' }, version);
    }
    expect(content.poolSize(settings.live().questions)).toBe(0);
    await runner.run(ops.updateSection('combat'), { expectedVersion: 1, changes: { startingHealth: 90 } }, writer);
  });

  it('narrows by question bank (curriculum), and refuses unknown curricula', async () => {
    const content = await contentServiceWith();
    const gcse = content.pool({ ...ALL_QUESTIONS, curriculumIds: ['gb-gcse'] });
    expect(gcse.length).toBeGreaterThan(20);
    for (const q of gcse) expect(content.placeOf(q)).toMatchObject({ curriculumId: 'gb-gcse' });
    expect(content.checkPool({ ...ALL_QUESTIONS, curriculumIds: ['gb-gcse'], levelIds: ['in-cbse-class-10'] })).toMatchObject([{ path: 'levelIds' }]);
    expect(content.checkPool({ ...ALL_QUESTIONS, curriculumIds: ['nowhere'] })).toEqual([{ path: 'curriculumIds.0', message: 'no curriculum "nowhere"' }]);
  });

  it('gives every built-in world but the prototype court its own pool, each of them askable', async () => {
    const content = await contentServiceWith();
    for (const world of BUILTIN_WORLDS) {
      if (world.id === PROTOTYPE_WORLD.id) {
        expect(world.questions, world.id).toBeUndefined();
        continue;
      }
      expect(world.questions, world.id).toBeDefined();
      expect(content.checkPool(world.questions!), world.id).toEqual([]);
      expect(content.poolSize(world.questions!), world.id).toBeGreaterThanOrEqual(15);
    }
    expect(new Set(BUILTIN_WORLDS.map((w) => JSON.stringify(w.questions ?? null))).size).toBe(BUILTIN_WORLDS.length);
  });

  it("sets a world's own pool through update_world and create_world, checked like the room-wide one", async () => {
    const content = await contentServiceWith();
    const settings = new SettingsService(new InMemorySettingsStore(), DEFAULT_SEED, { devRoomCode: 'DEV' }, content);
    await settings.load();
    const audit = new OperationAuditLog();
    vi.spyOn(audit, 'call').mockImplementation(() => {});
    const runner = new OperationRunner({ timeoutMs: 5_000 }, audit);
    const ops = new SettingsOperations(settings);
    const physics = { ...ALL_QUESTIONS, levelIds: ['gb-gcse-year-11'], subjectIds: ['physics'] };

    // The room plays Maple Park, which asks CBSE questions whatever the room-wide pool says.
    expect(questionPoolOf(settings.live())).toEqual(settings.worldRecord('maple-park')!.value.questions);

    const bad = await refusal(runner.run(ops.updateWorld, { id: 'maple-park', expectedVersion: 1, questions: { ...physics, subjectIds: ['nowhere'] } }, writer));
    expect(bad).toMatchObject({ kind: 'invalid', issues: [{ path: 'questions.subjectIds.0' }] });
    await runner.run(ops.updateWorld, { id: 'maple-park', expectedVersion: 1, questions: physics }, writer);
    expect(questionPoolOf(settings.live())).toEqual(physics);
    // Other changes keep the pool; null hands the world back to the room-wide pool.
    await runner.run(ops.updateWorld, { id: 'maple-park', expectedVersion: 2, name: 'Maple' }, writer);
    expect(settings.worldRecord('maple-park')!.value.questions).toEqual(physics);
    await runner.run(ops.updateWorld, { id: 'maple-park', expectedVersion: 3, questions: null }, writer);
    expect(settings.worldRecord('maple-park')!.value).not.toHaveProperty('questions');
    expect(questionPoolOf(settings.live())).toEqual(settings.live().questions);

    // A copy keeps the copied world's pool; a dry run reports a pool that cannot be asked.
    await runner.run(ops.createWorld, { id: 'frost-copy', name: 'Frost copy', start: { from: 'copy', worldId: 'frost-fort' } }, writer);
    expect(settings.worldRecord('frost-copy')!.value.questions).toEqual(settings.worldRecord('frost-fort')!.value.questions);
    const dry = await runner.run(ops.createWorld, { id: 'x-world', name: 'X', start: { from: 'blank' }, questions: { ...ALL_QUESTIONS, difficulty: [5, 5], subjectIds: ['geography'] }, dryRun: true }, writer);
    expect(dry).toMatchObject({ dryRun: true, valid: false, issues: [{ path: 'questions.levelIds' }] });
  });
});

describe('JsonFileContentStore', () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('writes the bank to a file that loads back, validated', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'volleyland-content-'));
    const file = path.join(dir, 'questions.json');
    const content = await contentServiceWith(TINY, new JsonFileContentStore(file));
    await content.update('countries', { id: 'xx', name: 'Testland Republic' }, 1);
    const text = await readFile(file, 'utf8');
    const state = parseContentFile(text);
    expect(state.records.countries[0]).toMatchObject({ version: 2, value: { name: 'Testland Republic' } });
    expect(state.seeded).toContain('questions:q-1');
    const reopened = await contentServiceWith(TINY, new JsonFileContentStore(file));
    expect(reopened.get('countries', 'xx')?.value.name).toBe('Testland Republic');

    const broken = JSON.parse(text) as { records: { questions: { value: { correctOptionId: string } }[] } };
    broken.records.questions[0]!.value.correctOptionId = 'z';
    expect(() => parseContentFile(JSON.stringify(broken))).toThrow(/questions q-1: correctOptionId must name one of the options/);
  });
});
