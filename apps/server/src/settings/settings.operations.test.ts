import { type Versioned, WorldSchema } from '@volleyland/contracts';
import { BUILTIN_WORLDS, DEFAULT_WORLD_ID, type World, createRng } from '@volleyland/game-core';
import { contentServiceWith } from '../content-workflow/testing.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomRegistry } from '../match-simulation/room-registry.service.js';
import { RoomOperations } from '../match-simulation/rooms.operations.js';
import { OperationAuditLog } from '../operations/operation-audit.js';
import { OperationRunner } from '../operations/operation-runner.service.js';
import { type Actor, type AnyOperation, OperationError } from '../operations/operation.js';
import { seedQuestions } from '../content-workflow/seed.js';
import type { QuestionSelectionService } from '../question-selection/question-selection.service.js';
import { QuestionSelector } from '../question-selection/question-selector.js';
import { DEFAULT_SECTIONS, DEFAULT_SEED } from './defaults.js';
import { InMemorySettingsStore } from './in-memory-settings-store.js';
import { SettingsOperations, type WorldDryRun } from './settings.operations.js';
import { SettingsService } from './settings.service.js';

const writer: Actor = { requestId: 'r1', principal: { kind: 'admin-token' }, access: 'write', via: 'rest', userAgent: null };
const reader: Actor = { ...writer, access: 'read', via: 'mcp' };

let registry: RoomRegistry | null = null;
afterEach(() => {
  registry?.onModuleDestroy();
  registry = null;
  vi.restoreAllMocks();
});

async function setup() {
  const settings = new SettingsService(new InMemorySettingsStore(), DEFAULT_SEED, { devRoomCode: 'DEV' }, await contentServiceWith());
  await settings.load();
  const audit = new OperationAuditLog();
  vi.spyOn(audit, 'call').mockImplementation(() => {});
  const runner = new OperationRunner({ timeoutMs: 5_000 }, audit);
  const ops = new SettingsOperations(settings);
  const run = <T>(op: { name: string } & AnyOperation, input: unknown, actor = writer) => runner.run(op, input, actor) as Promise<T>;
  return { settings, ops, run };
}

const refusal = async (promise: Promise<unknown>): Promise<OperationError> => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(OperationError);
  return error as OperationError;
};

describe('settings operations', () => {
  it('cover every admin panel action under stable names', () => {
    const names = new SettingsOperations({} as SettingsService).operations().map((o) => o.name);
    // MCP clients call these by name: change this list on purpose, never by accident.
    expect(names.sort()).toEqual([
      'check_world',
      'create_world',
      'delete_world',
      'edit_world',
      'get_settings',
      'get_world',
      'get_world_catalogue',
      'list_worlds',
      'reset_settings_section',
      'update_appearance_settings',
      'update_bots_settings',
      'update_camera_settings',
      'update_combat_settings',
      'update_movement_settings',
      'update_projectiles_settings',
      'update_questions_settings',
      'update_rooms_settings',
      'update_simulation_settings',
      'update_weapons_settings',
      'update_world',
    ]);
  });

  it('reads settings, and updates a section from just the changed settings', async () => {
    const { ops, run } = await setup();
    const view = await run<{ sections: { rooms: { version: number } } }>(ops.getSettings, {});
    expect(view).toMatchObject({ devRoomCode: 'DEV', defaults: DEFAULT_SECTIONS });
    expect(view).not.toHaveProperty('worlds');

    const saved = await run(ops.updateSection('rooms'), { expectedVersion: 1, changes: { maxPlayers: 6 } });
    expect(saved).toMatchObject({ version: 2, value: { maxPlayers: 6, worldId: DEFAULT_WORLD_ID } });
    expect(await refusal(run(ops.updateSection('rooms'), { expectedVersion: 1, changes: { maxPlayers: 5 } }))).toMatchObject({ kind: 'conflict' });
    expect(await refusal(run(ops.updateSection('rooms'), { expectedVersion: 2, changes: {} }))).toMatchObject({ kind: 'invalid' });
    expect(await refusal(run(ops.updateSection('rooms'), { expectedVersion: 2, changes: { maxPlayers: 99 } }))).toMatchObject({ kind: 'invalid' });
    expect(await refusal(run(ops.updateSection('rooms'), { expectedVersion: 2, changes: { worldId: 'nowhere' } }))).toMatchObject({
      kind: 'invalid',
      issues: [{ path: 'worldId', message: 'no world "nowhere"' }],
    });
    expect(await refusal(run(ops.updateSection('combat'), { expectedVersion: 1, changes: { answerTimeMs: 999_999 } }))).toMatchObject({ kind: 'invalid' });

    const reset = await run(ops.resetSection, { section: 'rooms', expectedVersion: 2 });
    expect(reset).toMatchObject({ version: 3, value: DEFAULT_SECTIONS.rooms });
  });

  it('refuses every write to a read-only actor', async () => {
    const { ops, run } = await setup();
    for (const op of ops.operations().filter((o) => o.access === 'write')) {
      expect(await refusal(run(op, {}, reader)), op.name).toMatchObject({ kind: 'forbidden' });
    }
  });

  it('lists, reads and describes worlds', async () => {
    const { ops, run } = await setup();
    const summaries = await run<{ id: string; inUse: boolean; props: number }[]>(ops.listWorlds, {});
    expect(summaries.map((w) => w.id).sort()).toEqual(BUILTIN_WORLDS.map((w) => w.id).sort());
    expect(summaries.filter((w) => w.inUse).map((w) => w.id)).toEqual([DEFAULT_WORLD_ID]);
    expect(await run<unknown[]>(ops.listWorlds, { detail: 'full' })).toHaveLength(BUILTIN_WORLDS.length);

    expect(await run(ops.getWorld, { id: DEFAULT_WORLD_ID })).toMatchObject({ version: 1, value: { id: DEFAULT_WORLD_ID } });
    expect(await refusal(run(ops.getWorld, { id: 'nowhere' }))).toMatchObject({ kind: 'not_found' });

    const catalogue = await run<{ themes: unknown[]; props: { kind: string; shape: string }[] }>(ops.getWorldCatalogue, {});
    expect(catalogue.themes).toHaveLength(7);
    expect(catalogue.props.find((p) => p.kind === 'tree')?.shape).toMatch(/^circle/);

    const checks = await run<{ checks: { level: string }[] }>(ops.checkPlay, { id: DEFAULT_WORLD_ID });
    expect(checks.checks.filter((c) => c.level === 'problem')).toEqual([]);
    expect(await refusal(run(ops.checkPlay, {}))).toMatchObject({ kind: 'invalid' });
  });

  it('creates worlds from blank, generated, copied and given layouts, with dry runs', async () => {
    const { ops, run, settings } = await setup();
    const blank = await run<{ version: number; value: World }>(ops.createWorld, { id: 'blank-one', name: 'Blank', start: { from: 'blank', theme: 'snow' } });
    expect(blank).toMatchObject({ version: 1, value: { id: 'blank-one', layout: { theme: 'snow', props: [] } } });

    const generated = await run<{ value: World }>(ops.createWorld, { id: 'gen', name: 'Generated', start: { from: 'generate', theme: 'beach', width: 80, depth: 80, seed: 4 } });
    expect(generated.value.layout.props.length).toBeGreaterThan(10);

    const copy = await run<{ value: World }>(ops.createWorld, { id: 'copy', name: 'Copy', start: { from: 'copy', worldId: 'gen' } });
    expect(copy.value.layout).toEqual(generated.value.layout);

    const dry = await run<WorldDryRun>(ops.createWorld, { id: 'dry', name: 'Dry', start: { from: 'layout', layout: blank.value.layout }, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, valid: true, world: { id: 'dry', props: 0 } });
    expect(settings.worldRecord('dry')).toBeNull();

    expect(await refusal(run(ops.createWorld, { id: 'gen', name: 'Again', start: { from: 'blank' } }))).toMatchObject({ kind: 'conflict' });
    expect(await refusal(run(ops.createWorld, { id: 'Bad ID', name: 'x', start: { from: 'blank' } }))).toMatchObject({ kind: 'invalid' });
  });

  it('edits a world in one save, checks it in a dry run, and replaces parts of it', async () => {
    const { ops, run, settings } = await setup();
    await run(ops.createWorld, { id: 'build', name: 'Build', start: { from: 'blank' } });

    const tree = { op: 'add_prop', kind: 'tree', x: 10, z: 10 };
    const dry = await run<WorldDryRun>(ops.editWorld, { id: 'build', expectedVersion: 1, edits: [tree], dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, valid: true, world: { props: 1 } });
    expect(settings.worldRecord('build')!.version).toBe(1);

    const offFloor = await run<WorldDryRun>(ops.editWorld, { id: 'build', expectedVersion: 1, edits: [{ op: 'add_prop', kind: 'tree', x: 29.5, z: 0 }], dryRun: true });
    expect(offFloor).toMatchObject({ valid: false, issues: [{ path: 'layout.props.0', message: expect.stringContaining('past the floor edge') }] });

    const edited = await run<Versioned<World>>(ops.editWorld, {
      id: 'build',
      expectedVersion: 1,
      edits: [tree, { op: 'mirror', items: [{ kind: 'prop', index: 0 }], symmetry: 'quad' }],
    });
    expect(edited.version).toBe(2);
    expect(edited.value.layout.props).toHaveLength(4);
    expect(await refusal(run(ops.editWorld, { id: 'build', expectedVersion: 1, edits: [tree] }))).toMatchObject({ kind: 'conflict' });
    expect(ops.editWorld.summarize!(edited)).toMatchObject({ id: 'build', version: 2, props: 4 });

    const renamed = await run<{ value: World }>(ops.updateWorld, { id: 'build', expectedVersion: 2, name: 'Built' });
    expect(renamed.value).toMatchObject({ name: 'Built', layout: edited.value.layout });
    expect(WorldSchema.safeParse(renamed.value).success).toBe(true);
  });

  it('deletes a world unless rooms play in it', async () => {
    const { ops, run } = await setup();
    await run(ops.createWorld, { id: 'spare', name: 'Spare', start: { from: 'blank' } });
    expect(await refusal(run(ops.deleteWorld, { id: DEFAULT_WORLD_ID, expectedVersion: 1 }))).toMatchObject({ kind: 'invalid' });
    expect(await run(ops.deleteWorld, { id: 'spare', expectedVersion: 1 })).toBeUndefined();
    expect(await refusal(run(ops.deleteWorld, { id: 'spare', expectedVersion: 1 }))).toMatchObject({ kind: 'not_found' });
  });
});

describe('room operations', () => {
  it('list open rooms with their match, world and seats, and nothing about questions', async () => {
    const { settings, run } = await setup();
    const questions = { forMatch: () => new QuestionSelector(seedQuestions(), createRng(1)) } as unknown as QuestionSelectionService;
    registry = new RoomRegistry(settings, questions);
    registry.useSinkFactory(() => ({ toRoom: () => {}, toPlayer: () => {} }));
    const rooms = new RoomOperations(registry);

    expect(await run(rooms.listRooms, {}, reader)).toEqual([]);
    registry.join('DEV', 'h1');
    const [room] = await run<Record<string, unknown>[]>(rooms.listRooms, {}, reader);
    expect(room).toEqual({
      code: 'DEV',
      matchId: registry.matchFor('DEV')!.id,
      worldId: DEFAULT_WORLD_ID,
      tick: 0,
      humans: 1,
      bots: DEFAULT_SECTIONS.bots.fillRoomTo - 1,
      maxPlayers: DEFAULT_SECTIONS.rooms.maxPlayers,
    });
  });
});
