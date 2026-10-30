import { CONTENT_REFERENCES, ContentKind } from '@volleyland/contracts';
import { AUTHORING_SCHEMAS, type AuthoredQuestion, type ContentSet, KINDS_IN_DEPENDENCY_ORDER } from './authored-question.js';
import { emptyContentRecords, referenceOf } from './in-memory-content-store.js';
import ukGcseYear11 from './seed/gb-gcse-year-11.json' with { type: 'json' };
import indiaCbseClass10 from './seed/in-cbse-class-10.json' with { type: 'json' };
import subjects from './seed/subjects.json' with { type: 'json' };

/** What an empty question bank is seeded with (tests override it). */
export const CONTENT_SEED = Symbol('CONTENT_SEED');

/**
 * The built-in question bank: India CBSE Class 10 and UK GCSE (AQA) Year 11, over subjects shared
 * by both. Every seeded question is original, written to the cited textbook or specification
 * (source use "aligned"); none are copied from copyrighted papers.
 *
 * Seed records reach an install once each, by ID (like built-in worlds): a fix to a seeded
 * question here does not overwrite the copy an install already has. Ship such a fix as a new
 * question ID, or edit it through the CMS.
 */
const SEED_FILES: { name: string; content: Partial<Record<ContentKind, unknown[]>> }[] = [
  { name: 'subjects.json', content: subjects },
  { name: 'in-cbse-class-10.json', content: indiaCbseClass10 },
  { name: 'gb-gcse-year-11.json', content: ukGcseYear11 },
];

/** Merge and validate the seed files, so a bad seed fails at startup (and in tests), not mid-match. */
export function loadSeedContent(files = SEED_FILES): ContentSet {
  const seed = emptyContentRecords() as unknown as Record<ContentKind, { id: string }[]>;
  const fail = (message: string): never => {
    throw new Error(`Invalid question bank seed: ${message}`);
  };
  for (const { name, content } of files) {
    for (const kind of ContentKind.options) {
      for (const raw of content[kind] ?? []) {
        const parsed = AUTHORING_SCHEMAS[kind].safeParse(raw);
        if (!parsed.success) fail(`${name} ${kind} ${String((raw as { id?: unknown }).id)}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
        if (seed[kind].some((r) => r.id === parsed.data!.id)) fail(`${name}: ${kind} "${parsed.data!.id}" is defined twice`);
        seed[kind].push(parsed.data!);
      }
    }
  }
  for (const kind of KINDS_IN_DEPENDENCY_ORDER) {
    for (const record of seed[kind]) {
      for (const ref of CONTENT_REFERENCES[kind]) {
        const target = referenceOf(record, ref.field);
        if (!seed[ref.kind].some((r) => r.id === target)) fail(`${kind} "${record.id}": ${ref.field} "${target}" is not in the seed`);
      }
    }
  }
  return seed as unknown as ContentSet;
}

export const DEFAULT_CONTENT_SEED: ContentSet = loadSeedContent();

/** The seeded questions that are published, sorted by ID (for tests that need a bank). */
export const seedQuestions = (): AuthoredQuestion[] =>
  DEFAULT_CONTENT_SEED.questions.filter((q) => q.status === 'published').sort((a, b) => a.id.localeCompare(b.id));
