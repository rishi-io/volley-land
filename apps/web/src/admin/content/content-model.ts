import { CONTENT_REFERENCES, CONTENT_SCHEMAS, CONTENT_TEXT, type ContentKind, contentFieldText } from '@volleyland/contracts';
import type { AdminContent, ContentRecord } from '../api';

/*
 * The question bank pages' form layout. Words (labels and help) come from the contracts schemas,
 * which MCP clients see too; which fields refer to other records comes from CONTENT_REFERENCES.
 * This file only says how each field is edited and which columns a list shows.
 */

export type TaxonomyKind = Exclude<ContentKind, 'questions'>;

type InputKind = 'id' | 'text' | 'textarea' | 'integer' | 'ages' | 'url' | 'year' | 'ref';

export interface ContentField {
  key: string;
  input: InputKind;
  /** For 'ref': the kind of record it names. */
  refKind?: ContentKind;
  label: string;
  help: string;
  unit?: string;
}

const INPUTS: Record<TaxonomyKind, Record<string, Exclude<InputKind, 'id' | 'ref'>>> = {
  countries: { name: 'text' },
  curricula: { name: 'text', description: 'textarea' },
  levels: { name: 'text', order: 'integer', ages: 'ages', description: 'textarea' },
  subjects: { name: 'text', description: 'textarea' },
  topics: { name: 'text', description: 'textarea' },
  sources: { title: 'text', publisher: 'text', url: 'url', year: 'year', licence: 'text', notes: 'textarea' },
};

/** The fields of a taxonomy kind, in schema order, with their words. */
export function fieldsOf(kind: TaxonomyKind): ContentField[] {
  return Object.keys(CONTENT_SCHEMAS[kind].shape).map((key) => {
    const ref = CONTENT_REFERENCES[kind].find((r) => r.field === key);
    const text = contentFieldText(kind, key);
    return {
      key,
      input: key === 'id' ? 'id' : ref ? 'ref' : INPUTS[kind][key]!,
      ...(ref ? { refKind: ref.kind } : {}),
      label: text?.title ?? key,
      help: text?.description ?? '',
      ...(text?.unit ? { unit: text.unit } : {}),
    };
  });
}

/** The words for a question field (`source.use` reads the attribution's). */
export const questionText = (key: string) => contentFieldText('questions', key) ?? { title: key, description: '' };

export type Draft = Record<string, string>;

/** Inputs hold text while being typed; values are parsed when the draft is saved. */
export function toDraft(kind: TaxonomyKind, value: Record<string, unknown> | null): Draft {
  const draft: Draft = {};
  for (const field of fieldsOf(kind)) {
    const v = value?.[field.key];
    draft[field.key] = field.input === 'ages' ? (Array.isArray(v) ? v.join('–') : '') : v === null || v === undefined ? '' : String(v);
  }
  return draft;
}

const number = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));

export function fromDraft(kind: TaxonomyKind, draft: Draft): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const field of fieldsOf(kind)) {
    const text = draft[field.key] ?? '';
    if (field.input === 'integer') value[field.key] = number(text);
    else if (field.input === 'ages') value[field.key] = text.split(/[–-]/).map(number);
    else if (field.input === 'url') value[field.key] = text.trim() === '' ? null : text.trim();
    else if (field.input === 'year') value[field.key] = text.trim() === '' ? null : number(text);
    else value[field.key] = field.input === 'textarea' ? text : text.trim();
  }
  return value;
}

/** Problems keyed by field, from the schema the server validates with. */
export function validate(kind: ContentKind, value: unknown): Record<string, string> {
  const result = CONTENT_SCHEMAS[kind].safeParse(value);
  const issues: Record<string, string> = {};
  if (!result.success) for (const issue of result.error.issues) issues[issue.path.map(String).join('.')] ??= issue.message;
  return issues;
}

/** Field issues from a server refusal, keyed like local ones. */
export const issuesFrom = (issues: { path: string; message: string }[] | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const issue of issues ?? []) out[issue.path] ??= issue.message;
  return out;
};

/** How records are named in lists and pickers: with their parents, so "Class 10" says which curriculum. */
export function labeller(data: AdminContent) {
  const find = <K extends TaxonomyKind>(kind: K, id: string) => (data[kind] as ContentRecord[]).find((r) => r.value.id === id)?.value as AdminContent[K][number]['value'] | undefined;
  const label = (kind: ContentKind, id: string): string => {
    switch (kind) {
      case 'countries':
        return find('countries', id)?.name ?? id;
      case 'curricula': {
        const c = find('curricula', id);
        return c ? `${c.name} (${label('countries', c.countryId)})` : id;
      }
      case 'levels': {
        const l = find('levels', id);
        const c = l && find('curricula', l.curriculumId);
        return l ? `${c?.name ?? l.curriculumId} ${l.name}` : id;
      }
      case 'subjects':
        return find('subjects', id)?.name ?? id;
      case 'topics': {
        const t = find('topics', id);
        return t ? `${t.name} (${label('levels', t.levelId)}, ${label('subjects', t.subjectId)})` : id;
      }
      case 'sources':
        return find('sources', id)?.title ?? id;
      case 'questions':
        return id;
    }
  };
  return { label, find };
}

export const NAV_KINDS: ContentKind[] = ['questions', 'sources', 'topics', 'subjects', 'levels', 'curricula', 'countries'];
export const kindTitle = (kind: ContentKind) => CONTENT_TEXT[kind].title;
