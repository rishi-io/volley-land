import { CONTENT_LIMITS, CONTENT_SCHEMAS, type ContentKind, QuestionOptionIdSchema, QuestionShape, field, uniqueOptionIds } from '@volleyland/contracts';
import { z } from 'zod';

/**
 * A question with its answer key, as authors write it and the server stores it. Server-only: the
 * answer key never goes into @volleyland/contracts, and only write-access actors (authors) are
 * ever shown these fields (see content.operations.ts).
 */
export const AuthoredQuestionShape = QuestionShape.extend({
  correctOptionId: QuestionOptionIdSchema.meta(field('Correct option', 'The ID of the one correct option.')),
  explanation: z
    .string()
    .trim()
    .max(CONTENT_LIMITS.maxExplanation)
    .meta(field('Explanation', 'Shown to the player after they answer: why the correct option is right.')),
});

export const AuthoredQuestionSchema = AuthoredQuestionShape.refine((q) => uniqueOptionIds(q.options), { path: ['options'], message: 'option IDs must be unique' }).refine(
  (q) => q.options.some((o) => o.id === q.correctOptionId),
  { path: ['correctOptionId'], message: 'must name one of the options' },
);

export type AuthoredQuestion = z.infer<typeof AuthoredQuestionSchema>;

/** The fields of a question that are its answer key: never in a read-only actor's output. */
export const ANSWER_KEY_FIELDS = ['correctOptionId', 'explanation'] as const;

/** A question without its answer key. */
export const withoutAnswerKey = ({ correctOptionId: _key, explanation: _explanation, ...question }: AuthoredQuestion) => question;

/** How each kind is validated when written: the contracts schemas, with the answer key for questions. */
export const AUTHORING_SCHEMAS = { ...CONTENT_SCHEMAS, questions: AuthoredQuestionSchema } as const satisfies Record<ContentKind, z.ZodType>;

export type ContentValue<K extends ContentKind> = z.infer<(typeof AUTHORING_SCHEMAS)[K]>;
export type AnyContentValue = ContentValue<ContentKind>;

/** Every kind's values (a seed, or an import). */
export type ContentSet = { [K in ContentKind]: ContentValue<K>[] };

/** Kinds in the order they can be inserted: everything a record refers to comes before it. */
export const KINDS_IN_DEPENDENCY_ORDER = ['countries', 'curricula', 'levels', 'subjects', 'topics', 'sources', 'questions'] as const satisfies readonly ContentKind[];
