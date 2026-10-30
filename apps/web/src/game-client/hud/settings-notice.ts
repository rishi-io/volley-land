import type { SettingChange } from '@volleyland/contracts';
import { type FieldSpec, SECTIONS } from '@/admin/catalog';

/** Admin changes the player is being told about. */
export interface SettingsNotice {
  /** The changes started a new match (everyone respawned). */
  newMatch: boolean;
  changes: SettingChange[];
}

export interface NoticeGroup {
  title: string;
  lines: { label: string; value: string }[];
}

const keyOf = (c: SettingChange) => `${c.section}.${c.key}`;

/**
 * Fold new changes into the notice still on screen, so quick successive saves read as one: each
 * setting keeps its first `from` and latest `to`, and drops out if it ends where it started.
 * Null when nothing is left to say (a display change undone before the notice went away).
 */
export function mergeNotice(current: SettingsNotice | null, newMatch: boolean, changes: SettingChange[]): SettingsNotice | null {
  const merged = new Map((current?.changes ?? []).map((c) => [keyOf(c), c]));
  for (const change of changes) {
    const earlier = merged.get(keyOf(change));
    merged.set(keyOf(change), earlier ? { ...change, from: earlier.from } : change);
  }
  const notice = {
    newMatch: newMatch || (current?.newMatch ?? false),
    changes: [...merged.values()].filter((c) => c.from === null || c.from !== c.to),
  };
  return notice.newMatch || notice.changes.length > 0 ? notice : null;
}

/** The changes in words, grouped under the admin panel's section titles and labels. */
export function describeNotice(notice: SettingsNotice): NoticeGroup[] {
  const groups = new Map<string, NoticeGroup>();
  const add = (title: string, label: string, value: string) => {
    const group = groups.get(title) ?? { title, lines: [] };
    if (!group.lines.some((l) => l.label === label)) group.lines.push({ label, value });
    groups.set(title, group);
  };
  for (const change of notice.changes) {
    if (change.section === 'world') {
      add('World', change.key === 'layout' ? 'Layout' : 'Name', change.key === 'layout' ? 'rebuilt' : values(change));
      continue;
    }
    const section = SECTIONS.find((s) => s.id === change.section);
    const title = section?.title ?? change.section;
    // Bot settings are not shown to players, only that they changed.
    if (change.section === 'bots') add(title, 'Behaviour', 'updated');
    else {
      const field = section?.fields.find((f) => f.key === change.key);
      add(title, field?.label ?? change.key, values(change, field));
    }
  }
  return [...groups.values()];
}

function values(change: SettingChange, field?: FieldSpec): string {
  if (change.from === null || change.to === null) return 'updated';
  return `${format(change.from, field)} → ${format(change.to, field)}`;
}

function format(value: number | string | boolean, field?: FieldSpec): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  const choice = field?.choices?.find((c) => c.value === value);
  if (choice) return choice.label;
  return field?.unit && typeof value === 'number' ? `${value} ${field.unit}` : String(value);
}
