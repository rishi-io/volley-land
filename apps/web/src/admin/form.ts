import { SECTION_SCHEMAS, type SettingsSection } from '@volleyland/contracts';
import { type SectionSpec, isIdList } from './catalog';

/** Inputs hold text while being typed; numbers are parsed only when the draft is read. */
export type DraftValue = string | boolean | [string, string] | string[];
export type SectionDraft = Record<string, DraftValue>;
export type FieldIssues = Record<string, string>;

const toNumber = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text));

export function toDraft(spec: SectionSpec, value: Record<string, unknown>): SectionDraft {
  const draft: SectionDraft = {};
  for (const field of spec.fields) {
    const v = value[field.key];
    if (field.kind === 'boolean') draft[field.key] = Boolean(v);
    else if (field.kind === 'colors' || isIdList(field.kind)) draft[field.key] = [...(v as string[])];
    else if (field.kind === 'range') {
      const [min, max] = v as [number, number];
      draft[field.key] = [String(min), String(max)];
    } else draft[field.key] = String(v);
  }
  return draft;
}

export function fromDraft(spec: SectionSpec, draft: SectionDraft): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const d = draft[field.key]!;
    if (field.kind === 'boolean' || field.kind === 'world' || field.kind === 'choice') value[field.key] = d;
    else if (field.kind === 'colors' || isIdList(field.kind)) value[field.key] = [...(d as string[])];
    else if (field.kind === 'range') {
      const [min, max] = d as [string, string];
      value[field.key] = [toNumber(min), toNumber(max)];
    } else value[field.key] = toNumber(d as string);
  }
  return value;
}

/** Problems keyed by field, from the same schema the server validates with. */
export function validateSection(section: SettingsSection, value: Record<string, unknown>): FieldIssues {
  const result = SECTION_SCHEMAS[section].safeParse(value);
  if (result.success) return {};
  const issues: FieldIssues = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '');
    issues[key] ??= issue.message;
  }
  return issues;
}

export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
