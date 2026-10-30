import {
  ADMIN_API_PREFIX,
  type ContentKind,
  CountrySchema,
  CurriculumSchema,
  LevelSchema,
  QuestionOptionIdSchema,
  QuestionShape,
  SourceSchema,
  SubjectSchema,
  TopicSchema,
  type AdminError,
  AdminErrorSchema,
  type AdminSettingsResponse,
  AdminSettingsResponseSchema,
  type SectionValue,
  type SettingsSection,
  type Versioned,
  type WorldDto,
  WorldSchema,
  versioned,
} from '@volleyland/contracts';
import { z } from 'zod';
import { resolveServerUrl } from '@/lib/server-url';

/** A failed admin call: the HTTP status plus the server's AdminError body when it sent one. */
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: AdminError | null,
  ) {
    super(body?.message ?? `Request failed (${status})`);
  }
}

const versionedWorld = z.strictObject({ value: WorldSchema, version: z.int().positive(), updatedAt: z.string() });

/**
 * A question with its answer key, as the CMS edits it. The panel is an authoring tool: admin REST
 * callers have write access, so the server sends authors the key. It is deliberately not a
 * contracts schema (the answer key never goes into @volleyland/contracts); the server's
 * AuthoredQuestionSchema is the one that validates it.
 */
export const AuthoredQuestionDtoSchema = QuestionShape.extend({ correctOptionId: QuestionOptionIdSchema, explanation: z.string() });
export type AuthoredQuestionDto = z.infer<typeof AuthoredQuestionDtoSchema>;

const AdminContentSchema = z.strictObject({
  countries: z.array(versioned(CountrySchema)),
  curricula: z.array(versioned(CurriculumSchema)),
  levels: z.array(versioned(LevelSchema)),
  subjects: z.array(versioned(SubjectSchema)),
  topics: z.array(versioned(TopicSchema)),
  sources: z.array(versioned(SourceSchema)),
});

const QuestionPageSchema = z.strictObject({ total: z.int(), offset: z.int(), questions: z.array(versioned(AuthoredQuestionDtoSchema)) });

/** The taxonomy and sources, as the CMS pages show them (questions are listed separately, filtered on the server). */
export type AdminContent = z.infer<typeof AdminContentSchema>;
export type ContentRecord = AdminContent[keyof AdminContent][number];
export type QuestionPage = z.infer<typeof QuestionPageSchema>;

/** list_questions filters. */
export interface QuestionFilter {
  countryId?: string;
  curriculumId?: string;
  levelId?: string;
  subjectId?: string;
  topicId?: string;
  sourceId?: string;
  status?: string;
  text?: string;
}

/** What an import reports: every problem by the question's position in the list. */
export interface ImportReport {
  dryRun: boolean;
  valid: boolean;
  issues: { path: string; message: string }[];
  ids: string[];
}

/** Typed client for the server's admin API (contracts in @volleyland/contracts settings.ts). */
export function createAdminApi(token: string | null) {
  async function request<T>(path: string, init: RequestInit, parse: (json: unknown) => T): Promise<T> {
    // Resolved per call: the page also renders on the server, where there is no window.
    const base = `${resolveServerUrl()}${ADMIN_API_PREFIX}`;
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      });
    } catch {
      throw new AdminApiError(0, { error: 'not_found', message: `Cannot reach the game server at ${base}. Is it running?` });
    }
    const text = await response.text();
    const json: unknown = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const body = AdminErrorSchema.safeParse(json);
      throw new AdminApiError(response.status, body.success ? body.data : null);
    }
    return parse(json);
  }

  return {
    settings: () => request('/settings', { method: 'GET' }, (json) => AdminSettingsResponseSchema.parse(json)),

    updateSection: <S extends SettingsSection>(section: S, value: SectionValue<S>, expectedVersion: number) =>
      request(`/settings/${section}`, { method: 'PUT', body: JSON.stringify({ value, expectedVersion }) }, (json) => json as Versioned<SectionValue<S>>),

    createWorld: (world: WorldDto) =>
      request('/worlds', { method: 'POST', body: JSON.stringify({ world, expectedVersion: null }) }, (json) => versionedWorld.parse(json)),

    updateWorld: (world: WorldDto, expectedVersion: number) =>
      request(`/worlds/${world.id}`, { method: 'PUT', body: JSON.stringify({ world, expectedVersion }) }, (json) => versionedWorld.parse(json)),

    deleteWorld: (id: string, expectedVersion: number) =>
      request(`/worlds/${id}?expectedVersion=${expectedVersion}`, { method: 'DELETE' }, () => undefined),

    content: () => request('/content', { method: 'GET' }, (json) => AdminContentSchema.parse(json)),

    questions: (filter: QuestionFilter, limit = 500) => {
      const query = new URLSearchParams({ limit: String(limit) });
      for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
      return request(`/content/questions?${query.toString()}`, { method: 'GET' }, (json) => QuestionPageSchema.parse(json));
    },

    createContent: (kind: ContentKind, record: Record<string, unknown>) =>
      request(`/content/${kind}`, { method: 'POST', body: JSON.stringify({ record }) }, (json) => json as Versioned<Record<string, unknown>>),

    updateContent: (kind: ContentKind, id: string, changes: Record<string, unknown>, expectedVersion: number) =>
      request(`/content/${kind}/${id}`, { method: 'PUT', body: JSON.stringify({ changes, expectedVersion }) }, (json) => json as Versioned<Record<string, unknown>>),

    deleteContent: (kind: ContentKind, id: string, expectedVersion: number) =>
      request(`/content/${kind}/${id}?expectedVersion=${expectedVersion}`, { method: 'DELETE' }, () => undefined),

    importQuestions: (questions: unknown[], dryRun: boolean) =>
      request('/content/questions/import', { method: 'POST', body: JSON.stringify({ questions, dryRun }) }, (json) => json as ImportReport),
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
export type { AdminSettingsResponse };
