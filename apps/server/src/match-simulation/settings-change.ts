import { isDeepStrictEqual } from 'node:util';
import type { SettingChange } from '@volleyland/contracts';
import { splitGameConfig } from '../settings/defaults.js';
import { type LiveSettings, questionPoolOf } from '../settings/settings.service.js';

/**
 * What a settings change means for a running room:
 * - `none`: nothing the room's players see or play by changed (e.g. a world it does not use).
 * - `presentation`: only appearance or camera changed; the match goes on and clients redraw.
 * - `rules`: rules, world, room, question pool or bot settings changed; the room starts a new match with them,
 *   because a running match never changes rules mid-game.
 */
export type SettingsChangeKind = 'none' | 'presentation' | 'rules';

export interface SettingsChange {
  kind: SettingsChangeKind;
  /** What changed, as players are told about it. Empty exactly when kind is `none`. */
  changes: SettingChange[];
}

/** Compare a room's running settings with saved ones. The list of changes also decides the kind, so players are told about every change that affects them. */
export function settingsChange(running: LiveSettings, next: LiveSettings): SettingsChange {
  const changes = (Object.keys(DIFF) as (keyof LiveSettings)[]).flatMap((part) => DIFF[part](running, next));
  const kind = changes.length === 0 ? 'none' : changes.every((c) => PRESENTATION.has(c.section)) ? 'presentation' : 'rules';
  return { kind, changes };
}

/** Sections that only change what players see, never how the match plays. */
const PRESENTATION: ReadonlySet<SettingChange['section']> = new Set(['appearance', 'camera']);

type Part = (running: LiveSettings, next: LiveSettings) => SettingChange[];

/** One differ per part of LiveSettings: adding a part does not compile until it is described here. */
const DIFF: { [K in keyof LiveSettings]: Part } = {
  game: (a, b) => {
    const before = splitGameConfig(a.game);
    const after = splitGameConfig(b.game);
    return (Object.keys(after) as (keyof typeof after)[]).flatMap((section) => diffRecord(section, before[section], after[section], true));
  },
  // worldId is reported by the world part, with the worlds' names.
  rooms: (a, b) => diffRecord('rooms', { ...a.rooms, worldId: null }, { ...b.rooms, worldId: null }, true),
  // The pool the room asks from: its world's own, else the room-wide one. A room-wide change does
  // not touch a room whose world has its own pool; a new world with another pool does.
  // Lists of IDs are reported as changed, without their values.
  questions: (a, b) => diffRecord('questions', questionPoolOf(a), questionPoolOf(b), true),
  // Bot behaviour is never sent to game clients: say what changed, not the values.
  bots: (a, b) => diffRecord('bots', a.bots, b.bots, false),
  appearance: (a, b) => diffRecord('appearance', a.appearance, b.appearance, true),
  camera: (a, b) => diffRecord('camera', a.camera, b.camera, true),
  world: (a, b) => {
    if (a.world.id !== b.world.id) return [{ section: 'rooms', key: 'worldId', from: a.world.name, to: b.world.name }];
    const changes: SettingChange[] = [];
    if (a.world.name !== b.world.name) changes.push({ section: 'world', key: 'name', from: a.world.name, to: b.world.name });
    if (!isDeepStrictEqual(a.world.layout, b.world.layout)) changes.push({ section: 'world', key: 'layout', from: null, to: null });
    return changes; // the description is admin-only and not sent to clients
  },
};

function diffRecord(section: SettingChange['section'], before: object, after: object, showValues: boolean): SettingChange[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((key) => !isDeepStrictEqual(a[key], b[key]))
    .map((key) => ({ section, key, from: showValues ? shown(a[key]) : null, to: showValues ? shown(b[key]) : null }));
}

/** Scalars are shown as they are; lists and objects (colour palettes, ranges) only as changed. */
const shown = (value: unknown): SettingChange['from'] =>
  typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' ? value : null;
