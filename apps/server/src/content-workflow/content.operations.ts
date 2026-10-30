import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ALL_QUESTIONS,
  CONTENT_LIMITS,
  CONTENT_REFERENCES,
  CONTENT_SCHEMAS,
  CONTENT_TEXT,
  ContentIdSchema,
  ContentKind,
  QuestionPoolSchema,
  QuestionStatusSchema,
  type Versioned,
} from '@volleyland/contracts';
import { z } from 'zod';
import { type Actor, type AnyOperation, OperationError, type OperationProvider, Operations, defineOperation } from '../operations/operation.js';
import { type AuthoredQuestion, AuthoredQuestionShape, type ContentValue, withoutAnswerKey } from './authored-question.js';
import { ContentService } from './content.service.js';

const expectedVersion = z
  .int()
  .positive()
  .describe('The version you last read (from a list_ or get_ call). If someone saved since, the call fails with a conflict: read again, then retry.');

/** The kinds edited as plain records; questions have their own operations. */
const TAXONOMY_KINDS = ['countries', 'curricula', 'levels', 'subjects', 'topics', 'sources'] as const satisfies readonly ContentKind[];
type TaxonomyKind = (typeof TAXONOMY_KINDS)[number];

const singular = (kind: ContentKind) => CONTENT_TEXT[kind].singular;
const lower = (kind: ContentKind) => CONTENT_TEXT[kind].title.toLowerCase();

/** What else to read before writing each kind, for the descriptions. */
const PARENTS = (kind: ContentKind): string =>
  CONTENT_REFERENCES[kind].length === 0
    ? ''
    : ` It refers to ${CONTENT_REFERENCES[kind].map((r) => `a ${singular(r.kind)} (${r.field}, see list_${r.kind})`).join(' and ')}, which must exist.`;

/** A question as this actor may see it: authors (write access) get the answer key, everyone else never does. */
const shownTo = (actor: Actor) => (record: Versioned<AuthoredQuestion>) =>
  actor.access === 'write' ? record : { ...record, value: withoutAnswerKey(record.value) };

const questionFields = AuthoredQuestionShape.omit({ id: true });

/**
 * The question bank CMS as operations: curriculum taxonomy (countries, curricula, levels,
 * subjects, topics), sources and questions. The admin REST API (ContentAdminController) and the
 * MCP server run them through OperationRunner; every rule lives in ContentService.
 *
 * Answer keys: questions carry correctOptionId and explanation only for write-access actors
 * (authors). Read-only MCP connections never see them, from any operation.
 */
@Operations()
@Injectable()
export class ContentOperations implements OperationProvider {
  constructor(@Inject(ContentService) private readonly content: ContentService) {}

  readonly overview = defineOperation({
    name: 'get_question_bank_overview',
    title: 'Question bank overview',
    description:
      'What the question bank covers: every country, curriculum and level (class or school year), and for each level its subjects with topic counts and draft, published and retired question counts. ' +
      'Start here to find IDs and to see where questions are missing.',
    input: z.object({}),
    access: 'read',
    run: () => ({
      countries: this.content.list('countries').map((r) => r.value),
      curricula: this.content.list('curricula').map((r) => ({ id: r.value.id, countryId: r.value.countryId, name: r.value.name })),
      subjects: this.content.list('subjects').map((r) => ({ id: r.value.id, name: r.value.name })),
      levels: this.content.overview(),
    }),
  });

  private readonly taxonomyOps = new Map(TAXONOMY_KINDS.map((kind) => [kind, this.taxonomyOperations(kind)]));

  /** The list, create, update and delete operations of one taxonomy kind. */
  taxonomy(kind: TaxonomyKind) {
    return this.taxonomyOps.get(kind)!;
  }

  readonly listQuestions = defineOperation({
    name: 'list_questions',
    title: 'List questions',
    description:
      'Questions in the bank, by ID, narrowed by any of: country, curriculum, level, subject, topic, source, status, and text in the prompt or options. ' +
      'Returns the total that match and one page of them. Answer keys are included only for connections with write access.',
    input: z.object({
      countryId: ContentIdSchema.optional(),
      curriculumId: ContentIdSchema.optional(),
      levelId: ContentIdSchema.optional().describe('A class or school year, e.g. in-cbse-class-10'),
      subjectId: ContentIdSchema.optional(),
      topicId: ContentIdSchema.optional(),
      sourceId: ContentIdSchema.optional(),
      status: QuestionStatusSchema.optional(),
      text: z.string().max(200).optional().describe('Words to look for in the ID, prompt or options'),
      offset: z.int().min(0).default(0),
      limit: z.int().min(1).max(5000).default(50),
    }),
    access: 'read',
    run: ({ offset, limit, ...filter }, actor) => {
      const all = this.content.findQuestions(filter);
      return { total: all.length, offset, questions: all.slice(offset, offset + limit).map(shownTo(actor)) };
    },
  });

  readonly getQuestion = defineOperation({
    name: 'get_question',
    title: 'Get a question',
    description: 'One question with its version and where it sits (topic, subject, level, curriculum, country). The answer key is included only for connections with write access.',
    input: z.object({ id: ContentIdSchema }),
    access: 'read',
    run: ({ id }, actor) => {
      const record = this.requireRecord('questions', id);
      return { ...shownTo(actor)(record), place: this.content.placeOf(record.value) };
    },
  });

  readonly createQuestion = defineOperation({
    name: 'create_question',
    title: 'Create a question',
    description:
      'Add a multiple-choice question to a topic, with its answer key, explanation and source (where it was copied, adapted or aligned from).' +
      PARENTS('questions') +
      ' New questions are drafts unless status is "published"; only published questions are asked in matches, from the next hit on.',
    input: questionFields.extend({
      id: ContentIdSchema.optional().describe('Stable ID; made up for you when left out'),
      status: QuestionStatusSchema.default('draft'),
    }),
    access: 'write',
    run: ({ id, ...question }) => this.content.create('questions', { id: id ?? `q-${randomUUID().slice(0, 8)}`, ...question }),
  });

  readonly updateQuestion = defineOperation({
    name: 'update_question',
    title: 'Update a question',
    description:
      'Change a question: pass only the fields to change in "changes" (options and source are replaced whole). Publish or retire it by changing status. ' +
      'Matches ask the new version from the next hit on.',
    input: z.object({
      id: ContentIdSchema,
      expectedVersion,
      changes: questionFields.partial().refine((c) => Object.keys(c).length > 0, 'name at least one field to change'),
    }),
    access: 'write',
    run: ({ id, expectedVersion, changes }) => this.content.update('questions', { ...this.requireRecord('questions', id).value, ...changes }, expectedVersion),
  });

  readonly deleteQuestion = defineOperation({
    name: 'delete_question',
    title: 'Delete a question',
    description: 'Delete a question for good. To stop asking it but keep it, set its status to "retired" with update_question instead.',
    input: z.object({ id: ContentIdSchema, expectedVersion }),
    access: 'write',
    destructive: true,
    run: async ({ id, expectedVersion }) => {
      await this.content.delete('questions', id, expectedVersion);
    },
  });

  readonly importQuestions = defineOperation({
    name: 'import_questions',
    title: 'Import questions',
    description:
      `Add up to ${CONTENT_LIMITS.maxImport} questions at once, all or nothing, e.g. a bank copied from a source. Each needs an ID, its topic, status, answer key and source. ` +
      'Create the source (create_source) and topics first. Use dryRun to see every problem, by position in the list, without saving.',
    input: z.object({
      questions: z.array(AuthoredQuestionShape).min(1).max(CONTENT_LIMITS.maxImport),
      dryRun: z.boolean().default(false).describe('Check the questions without saving them'),
    }),
    access: 'write',
    run: ({ questions, dryRun }) => this.content.importQuestions(questions, dryRun),
  });

  readonly previewPool = defineOperation({
    name: 'preview_question_pool',
    title: 'Preview a question pool',
    description:
      'How many published questions a match would ask from with these question banks (curricula), levels, subjects and difficulty, and why a pool cannot be used. ' +
      "Check this before setting a pool: a world's own (update_world, questions) or the room-wide one for worlds without their own (update_questions_settings).",
    input: QuestionPoolSchema.partial(),
    access: 'read',
    run: (pool) => {
      const full = { ...ALL_QUESTIONS, ...pool };
      return { questions: this.content.poolSize(full), issues: this.content.checkPool(full) };
    },
  });

  operations(): AnyOperation[] {
    return [
      this.overview,
      ...[...this.taxonomyOps.values()].flatMap((ops) => [ops.list, ops.create, ops.update, ops.remove]),
      this.listQuestions,
      this.getQuestion,
      this.createQuestion,
      this.updateQuestion,
      this.deleteQuestion,
      this.importQuestions,
      this.previewPool,
    ];
  }

  private taxonomyOperations<K extends TaxonomyKind>(kind: K) {
    const schema = CONTENT_SCHEMAS[kind] as z.ZodObject;
    const { title, summary } = CONTENT_TEXT[kind];
    const one = singular(kind);
    const filters = Object.fromEntries(CONTENT_REFERENCES[kind].map((r) => [r.field, ContentIdSchema.optional().describe(`Only ${lower(kind)} of this ${singular(r.kind)}`)]));
    return {
      list: defineOperation({
        name: `list_${kind}`,
        title: `List ${lower(kind)}`,
        description: `${title}: ${summary} Every one with its version${CONTENT_REFERENCES[kind].length > 0 ? `, optionally only those of one ${CONTENT_REFERENCES[kind].map((r) => singular(r.kind)).join(' or ')}` : ''}.`,
        input: z.object(filters),
        access: 'read',
        run: (input: Record<string, string | undefined>) =>
          this.content.list(kind).filter(({ value }) => Object.entries(input).every(([key, id]) => id === undefined || (value as Record<string, unknown>)[key] === id)),
      }),
      create: defineOperation({
        name: `create_${one}`,
        title: `Create a ${one}`,
        description: `Add a ${one}. ${summary}${PARENTS(kind)}`,
        input: schema,
        access: 'write',
        run: (input) => this.content.create(kind, input),
      }),
      update: defineOperation({
        name: `update_${one}`,
        title: `Update a ${one}`,
        description: `Change a ${one}: pass only the fields to change in "changes". Its ID cannot change.${PARENTS(kind)}`,
        input: z.object({
          id: ContentIdSchema,
          expectedVersion,
          changes: schema
            .omit({ id: true })
            .partial()
            .refine((c) => Object.keys(c).length > 0, 'name at least one field to change'),
        }),
        access: 'write',
        run: ({ id, expectedVersion, changes }) => this.content.update(kind, { ...this.requireRecord(kind, id).value, ...changes }, expectedVersion),
      }),
      remove: defineOperation({
        name: `delete_${one}`,
        title: `Delete a ${one}`,
        description: `Delete a ${one} for good. Refused while anything still refers to it (delete or move those first).`,
        input: z.object({ id: ContentIdSchema, expectedVersion }),
        access: 'write',
        destructive: true,
        run: async ({ id, expectedVersion }) => {
          await this.content.delete(kind, id, expectedVersion);
        },
      }),
    };
  }

  private requireRecord<K extends ContentKind>(kind: K, id: string): Versioned<ContentValue<K>> {
    const record = this.content.get(kind, id);
    if (!record) throw new OperationError('not_found', `No ${singular(kind)} "${id}". list_${kind} shows the ${lower(kind)} there are.`);
    return record;
  }
}
