import { z } from 'zod';
import { type SettingText, field } from './text.js';

/*
 * The question bank as the CMS manages it: a curriculum taxonomy (country → curriculum → level →
 * topic, each topic also in a subject), the sources questions come from, and the questions.
 *
 * Every record is its own versioned row with a stable slug ID that other records refer to, so the
 * move to Postgres is a store swap. The answer key (correctOptionId, explanation) is deliberately
 * absent: it is server-only and lives in the server's AuthoredQuestionSchema, never in contracts.
 */

export const CONTENT_LIMITS = {
  minOptions: 2,
  maxOptions: 6,
  maxPrompt: 2000,
  maxOptionText: 500,
  maxExplanation: 2000,
  maxName: 120,
  maxDescription: 1000,
  /** Questions in one import_questions call. */
  maxImport: 500,
} as const;

/** Lowercase slug: the stable ID other records refer to. */
export const ContentIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lowercase letters, digits and single hyphens');

const id = (description: string) => ContentIdSchema.meta(field('ID', `${description} Lowercase letters, digits and single hyphens; cannot change later.`));
const ref = (title: string, description: string) => ContentIdSchema.meta(field(title, description));
const name = (description: string) => z.string().trim().min(1).max(CONTENT_LIMITS.maxName).meta(field('Name', description));
const description = (text: string) => z.string().max(CONTENT_LIMITS.maxDescription).meta(field('Description', text));

export const CountrySchema = z.strictObject({
  id: id('The ISO 3166 two-letter country code, lowercase (in, gb, us).'),
  name: name('The country as players and teachers know it.'),
});

export const CurriculumSchema = z.strictObject({
  id: id('For example in-cbse or gb-gcse.'),
  countryId: ref('Country', 'The country this curriculum is taught in.'),
  name: name('The board, framework or qualification, e.g. CBSE or GCSE (England).'),
  description: description('Who sets it and where it is taught.'),
});

export const LevelSchema = z.strictObject({
  id: id('For example in-cbse-class-10.'),
  curriculumId: ref('Curriculum', 'The curriculum this class or school year belongs to.'),
  name: name('The class, grade or school year as the curriculum calls it, e.g. Class 10 or Year 11.'),
  order: z
    .int()
    .min(0)
    .max(100)
    .meta(field('Order', 'Sorts levels within a curriculum, youngest first. Usually the class or year number.')),
  ages: z
    .tuple([z.int().min(3).max(25), z.int().min(3).max(25)])
    .refine(([min, max]) => min <= max, 'ages must be [youngest, oldest]')
    .meta(field('Ages', 'Typical ages of students at this level ([youngest, oldest]); lines up levels across countries.', 'years')),
  description: description('What the level covers, e.g. the exam taken at the end of it.'),
});

export const SubjectSchema = z.strictObject({
  id: id('For example mathematics or biology.'),
  name: name('The subject, e.g. Mathematics.'),
  description: description('What the subject covers.'),
});

export const TopicSchema = z.strictObject({
  id: id('For example in-cbse-10-maths-quadratic-equations.'),
  levelId: ref('Level', 'The class or school year this topic is taught in.'),
  subjectId: ref('Subject', 'The subject this topic belongs to.'),
  name: name('The chapter or topic, e.g. Quadratic equations.'),
  description: description('What students learn in it.'),
});

export const SourceSchema = z.strictObject({
  id: id('For example ncert-mathematics-class-10.'),
  title: z.string().trim().min(1).max(200).meta(field('Title', 'The document the questions come from: a textbook, past paper, specification or question bank.')),
  publisher: z.string().trim().min(1).max(120).meta(field('Publisher', 'Who publishes it, e.g. NCERT, CBSE or AQA.')),
  url: z.url().max(500).nullable().meta(field('Link', 'Where the source can be found, if it is online.')),
  year: z.int().min(1900).max(2100).nullable().meta(field('Year', 'The year of the edition, paper or specification.')),
  licence: z
    .string()
    .max(300)
    .meta(field('Licence', 'Terms under which the source may be used, e.g. "© AQA; reproduced with permission" or "CC BY 4.0". Check this before copying questions.')),
  notes: description('Anything else about the source, e.g. which papers or chapters were used.'),
});

export const QuestionStatusSchema = z
  .enum(['draft', 'published', 'retired'])
  .meta(field('Status', 'Only published questions are asked in matches. Drafts are being written; retired questions are kept but no longer asked.'));

export const SourceUseSchema = z
  .enum(['copied', 'adapted', 'aligned'])
  .meta(field('Use of the source', 'copied: taken word for word; adapted: changed from a question in the source; aligned: written for this bank to match the source.'));

export const QuestionAttributionSchema = z.strictObject({
  sourceId: ref('Source', 'The source the question comes from.'),
  use: SourceUseSchema,
  reference: z
    .string()
    .max(200)
    .meta(field('Where in the source', 'The paper, question number, chapter or page, e.g. "Paper 1H, Q7" or "Chapter 4, Exercise 4.2".')),
});

export const QuestionOptionIdSchema = z.string().regex(/^[a-z0-9]{1,8}$/, 'use up to 8 lowercase letters or digits');

/** A question without its answer key. Extend it only on the server. */
export const QuestionShape = z.strictObject({
  id: id('For example q-cbse10-math-001.'),
  topicId: ref('Topic', 'The topic the question tests; it sets the level and subject.'),
  difficulty: z.int().min(1).max(5).meta(field('Difficulty', '1 is the easiest at its level, 5 the hardest.', '1–5')),
  status: QuestionStatusSchema,
  prompt: z.string().trim().min(1).max(CONTENT_LIMITS.maxPrompt).meta(field('Question', 'What the hit player is asked.')),
  options: z
    .array(z.strictObject({ id: QuestionOptionIdSchema, text: z.string().trim().min(1).max(CONTENT_LIMITS.maxOptionText) }))
    .min(CONTENT_LIMITS.minOptions)
    .max(CONTENT_LIMITS.maxOptions)
    .meta(field('Options', `${CONTENT_LIMITS.minOptions} to ${CONTENT_LIMITS.maxOptions} answers, each with a short ID (a, b, c…). Players see them shuffled.`)),
  source: QuestionAttributionSchema,
});

export const uniqueOptionIds = (options: readonly { id: string }[]): boolean => new Set(options.map((o) => o.id)).size === options.length;

export const QuestionSchema = QuestionShape.refine((q) => uniqueOptionIds(q.options), { path: ['options'], message: 'option IDs must be unique' });

export const ContentKind = z.enum(['countries', 'curricula', 'levels', 'subjects', 'topics', 'sources', 'questions']);
export type ContentKind = z.infer<typeof ContentKind>;

/** The schema of each kind of record (questions without their answer key). */
export const CONTENT_SCHEMAS = {
  countries: CountrySchema,
  curricula: CurriculumSchema,
  levels: LevelSchema,
  subjects: SubjectSchema,
  topics: TopicSchema,
  sources: SourceSchema,
  questions: QuestionSchema,
} as const satisfies Record<ContentKind, z.ZodType>;

export type Country = z.infer<typeof CountrySchema>;
export type Curriculum = z.infer<typeof CurriculumSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Question = z.infer<typeof QuestionSchema>;

/**
 * What refers to what: for each kind, the fields naming a record of another kind. The server
 * refuses a record whose references do not exist, and a delete while anything still refers to the
 * record (foreign keys, once this is a database). The panel uses it to offer the choices.
 */
export const CONTENT_REFERENCES = {
  countries: [],
  curricula: [{ field: 'countryId', kind: 'countries' }],
  levels: [{ field: 'curriculumId', kind: 'curricula' }],
  subjects: [],
  topics: [
    { field: 'levelId', kind: 'levels' },
    { field: 'subjectId', kind: 'subjects' },
  ],
  sources: [],
  questions: [
    { field: 'topicId', kind: 'topics' },
    { field: 'source.sourceId', kind: 'sources' },
  ],
} as const satisfies Record<ContentKind, readonly { field: string; kind: ContentKind }[]>;

/** Each kind's name, in words, as the admin panel and MCP tool descriptions show it. */
export const CONTENT_TEXT: Readonly<Record<ContentKind, { title: string; singular: string; summary: string }>> = Object.freeze({
  countries: { title: 'Countries', singular: 'country', summary: 'Where curricula are taught.' },
  curricula: { title: 'Curricula', singular: 'curriculum', summary: 'Boards, frameworks and qualifications, such as CBSE in India or GCSE in England.' },
  levels: { title: 'Classes and years', singular: 'level', summary: 'The classes, grades or school years of a curriculum, such as Class 10 or Year 11.' },
  subjects: { title: 'Subjects', singular: 'subject', summary: 'Mathematics, Science, Biology… Shared across curricula.' },
  topics: { title: 'Topics', singular: 'topic', summary: 'Chapters or topics of a subject at one level. Every question belongs to one.' },
  sources: { title: 'Sources', singular: 'source', summary: 'Textbooks, past papers, specifications and banks that questions come from, with their licence.' },
  questions: { title: 'Questions', singular: 'question', summary: 'Multiple-choice questions, each with its topic, difficulty, status and source.' },
});

/** A content field's words, read back from its schema (for the CMS forms). */
export function contentFieldText(kind: ContentKind, key: string): SettingText | null {
  const shape = (kind === 'questions' ? QuestionShape : CONTENT_SCHEMAS[kind]).shape as Record<string, z.ZodType>;
  const schema = key.startsWith('source.') ? (QuestionAttributionSchema.shape as Record<string, z.ZodType>)[key.slice(7)] : shape[key];
  const meta = schema?.meta() as Partial<SettingText> | undefined;
  return meta?.title && meta.description ? { title: meta.title, description: meta.description, ...(meta.unit ? { unit: meta.unit } : {}) } : null;
}

const uniqueIds = (title: string, description: string) =>
  z
    .array(ContentIdSchema)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, 'list each ID once')
    .meta(field(title, description));

/**
 * Which part of the question bank a match asks from. Empty lists mean "all"; the lists narrow
 * each other (a question must match every non-empty one). Used by the room-wide `questions`
 * settings section and by a world's own pool.
 */
export const QuestionPoolSchema = z.strictObject({
  curriculumIds: uniqueIds('Question banks', 'Ask only questions from these curricula (curriculum IDs, e.g. in-cbse, gb-gcse), any of their classes or years. None: every curriculum.'),
  levelIds: uniqueIds('Classes and years', 'Ask only questions for these levels (level IDs, e.g. in-cbse-class-10, gb-gcse-year-11). None: every level.'),
  subjectIds: uniqueIds('Subjects', 'Ask only questions in these subjects (subject IDs, e.g. mathematics). None: every subject.'),
  difficulty: z
    .tuple([z.int().min(1).max(5), z.int().min(1).max(5)])
    .refine(([min, max]) => min <= max, 'range must be [min, max] with min <= max')
    .meta(field('Difficulty', 'Ask only questions in this difficulty range ([min, max]); 1 is the easiest.', '1–5')),
});

export type QuestionPoolDto = z.infer<typeof QuestionPoolSchema>;

/** A pool that asks every published question. */
export const ALL_QUESTIONS: Readonly<QuestionPoolDto> = Object.freeze({ curriculumIds: [], levelIds: [], subjectIds: [], difficulty: [1, 5] });
