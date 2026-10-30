import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BUILTIN_WORLDS, DEFAULT_GAME_CONFIG, DEFAULT_WORLD_ID, PROTOTYPE_WORLD, type World } from '@volleyland/game-core';
import { contentServiceWith } from '../content-workflow/testing.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OperationError } from '../operations/operation.js';
import { DEFAULT_SECTIONS, DEFAULT_SEED } from './defaults.js';
import { InMemorySettingsStore } from './in-memory-settings-store.js';
import { JsonFileSettingsStore } from './json-file-settings-store.js';
import type { SettingsStore } from './settings-store.js';
import { SettingsService } from './settings.service.js';

const arenaWorld = (id: string, name = id): World => ({
  id,
  name,
  description: '',
  layout: {
    halfWidth: 10,
    halfDepth: 10,
    theme: 'classic',
    floor: 'court',
    scatter: 0,
    regions: [],
    props: [{ kind: 'block', x: 0, z: 0, width: 2, depth: 2, height: 1, rotation: 0 }],
    spawnPoints: [{ x: -5, z: 0 }, { x: 5, z: 0 }],
  },
});

async function serviceWith(store: SettingsStore = new InMemorySettingsStore()): Promise<SettingsService> {
  const service = new SettingsService(store, DEFAULT_SEED, { devRoomCode: 'DEV' }, await contentServiceWith());
  await service.load();
  return service;
}

const rejection = async (promise: Promise<unknown>): Promise<OperationError> => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(OperationError);
  return error as OperationError;
};

describe('SettingsService', () => {
  it('seeds an empty store with the defaults and serves them to new matches', async () => {
    const service = await serviceWith();
    expect(service.live()).toEqual({
      game: DEFAULT_GAME_CONFIG,
      rooms: DEFAULT_SECTIONS.rooms,
      questions: DEFAULT_SECTIONS.questions,
      bots: DEFAULT_SECTIONS.bots,
      appearance: DEFAULT_SECTIONS.appearance,
      camera: DEFAULT_SECTIONS.camera,
      world: BUILTIN_WORLDS.find((w) => w.id === DEFAULT_WORLD_ID),
    });
    expect(service.view().worlds.map((w) => w.value.id).sort()).toEqual(BUILTIN_WORLDS.map((w) => w.id).sort());
    expect(service.view().sections.combat).toMatchObject({ version: 1, value: DEFAULT_SECTIONS.combat });
  });

  it('saves a valid section, bumps its version and applies it to the next match', async () => {
    const service = await serviceWith();
    const saved = await service.updateSection('combat', { ...DEFAULT_SECTIONS.combat, wrongAnswerDamage: 40 }, 1);
    expect(saved.version).toBe(2);
    expect(service.live().game.wrongAnswerDamage).toBe(40);
  });

  it('tells listeners about every saved change, but not about rejected ones', async () => {
    const service = await serviceWith();
    const seen: number[] = [];
    const stop = service.onChange((live) => seen.push(live.game.wrongAnswerDamage));
    await service.updateSection('combat', { ...DEFAULT_SECTIONS.combat, wrongAnswerDamage: 40 }, 1);
    await rejection(service.updateSection('combat', { ...DEFAULT_SECTIONS.combat, startingHealth: -1 }, 2));
    await service.saveWorld(arenaWorld('yard'), null);
    stop();
    await service.updateSection('combat', { ...DEFAULT_SECTIONS.combat, wrongAnswerDamage: 10 }, 2);
    expect(seen).toEqual([40, 40]);
  });

  it('keeps a saved change when a listener throws', async () => {
    const service = await serviceWith();
    service.onChange(() => {
      throw new Error('listener bug');
    });
    const saved = await service.updateSection('combat', { ...DEFAULT_SECTIONS.combat, wrongAnswerDamage: 40 }, 1);
    expect(saved.version).toBe(2);
    expect(service.live().game.wrongAnswerDamage).toBe(40);
  });

  it('rejects invalid values, unknown keys and cross-section conflicts with field issues', async () => {
    const service = await serviceWith();
    const bad = await rejection(service.updateSection('combat', { ...DEFAULT_SECTIONS.combat, startingHealth: -1 }, 1));
    expect(bad.kind).toBe('invalid');
    expect(bad.issues[0]!.path).toBe('startingHealth');

    expect((await rejection(service.updateSection('bots', { ...DEFAULT_SECTIONS.bots, aimbot: true }, 1))).kind).toBe('invalid');

    const tooHigh = await rejection(service.updateSection('projectiles', { ...DEFAULT_SECTIONS.projectiles, projectileHeight: 5 }, 1));
    expect(tooHigh.issues.map((i) => i.path)).toContain('projectileHeight');

    const offTick = await rejection(service.updateSection('simulation', { ...DEFAULT_SECTIONS.simulation, tickRate: 30 }, 1));
    expect(offTick.issues.map((i) => i.path)).toContain('inputStepMs');

    const noWorld = await rejection(service.updateSection('rooms', { maxPlayers: 4, worldId: 'nowhere' }, 1));
    expect(noWorld.issues.map((i) => i.path)).toContain('worldId');
    expect(service.view().sections.combat.version).toBe(1); // nothing was saved
  });

  it('refuses a write based on a stale version', async () => {
    const service = await serviceWith();
    await service.updateSection('movement', { ...DEFAULT_SECTIONS.movement, playerSpeed: 7 }, 1);
    const stale = await rejection(service.updateSection('movement', { ...DEFAULT_SECTIONS.movement, playerSpeed: 8 }, 1));
    expect(stale.kind).toBe('conflict');
    expect(service.live().game.playerSpeed).toBe(7);
  });

  it('creates, switches to, updates and deletes worlds', async () => {
    const service = await serviceWith();
    const created = await service.saveWorld(arenaWorld('box-yard', 'Box yard'), null);
    expect(created.version).toBe(1);
    expect((await rejection(service.saveWorld(arenaWorld('box-yard'), null))).kind).toBe('conflict');

    await service.updateSection('rooms', { maxPlayers: 4, worldId: 'box-yard' }, 1);
    expect(service.live().world.id).toBe('box-yard');

    const renamed = await service.saveWorld({ ...arenaWorld('box-yard'), name: 'Box yard 2' }, 1);
    expect(renamed.version).toBe(2);
    expect(service.live().world.name).toBe('Box yard 2');

    expect((await rejection(service.deleteWorld('box-yard', 2))).message).toMatch(/rooms use/);
    await service.deleteWorld(PROTOTYPE_WORLD.id, 1);
    expect(service.view().worlds.map((w) => w.value.id)).not.toContain(PROTOTYPE_WORLD.id);
    expect(service.view().worlds.map((w) => w.value.id)).toContain('box-yard');
  });

  it('rejects worlds with off-floor or blocked spawn points', async () => {
    const service = await serviceWith();
    const world = arenaWorld('broken');
    world.layout.spawnPoints = [{ x: 0, z: 0 }, { x: 50, z: 0 }];
    const error = await rejection(service.saveWorld(world, null));
    expect(error.issues.map((i) => i.message)).toEqual(['Spawn point 1 is inside prop 1', 'Spawn point 2 is off the floor']);
  });
});

describe('JsonFileSettingsStore', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'volleyland-settings-'));
    file = path.join(dir, 'nested', 'settings.json');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('writes the seed and every change to disk, and a restarted server reads them back', async () => {
    const first = await serviceWith(new JsonFileSettingsStore(file));
    await first.updateSection('combat', { ...DEFAULT_SECTIONS.combat, wrongAnswerDamage: 40 }, 1);
    await first.saveWorld(arenaWorld('box-yard'), null);

    const onDisk = JSON.parse(await readFile(file, 'utf8')) as { format: number };
    expect(onDisk.format).toBe(4);

    const restarted = await serviceWith(new JsonFileSettingsStore(file));
    expect(restarted.live().game.wrongAnswerDamage).toBe(40);
    expect(restarted.view().sections.combat.version).toBe(2);
    expect(restarted.view().worlds.map((w) => w.value.id).sort()).toEqual(['box-yard', ...BUILTIN_WORLDS.map((w) => w.id)].sort());
  });

  it('seeds each built-in world once: a deleted one stays deleted, a new one arrives on the next start', async () => {
    const first = await serviceWith(new JsonFileSettingsStore(file));
    await first.deleteWorld(PROTOTYPE_WORLD.id, 1);
    const data = JSON.parse(await readFile(file, 'utf8')) as { worlds: { value: { id: string } }[]; seededWorlds: string[] };
    // As if Frost Fort shipped in a later version than this file was written by.
    data.worlds = data.worlds.filter((w) => w.value.id !== 'frost-fort');
    data.seededWorlds = data.seededWorlds.filter((id) => id !== 'frost-fort');
    await writeFile(file, JSON.stringify(data));

    const restarted = await serviceWith(new JsonFileSettingsStore(file));
    const ids = restarted.view().worlds.map((w) => w.value.id);
    expect(ids).not.toContain(PROTOTYPE_WORLD.id);
    expect(ids).toContain('frost-fort');
  });

  it('upgrades a format 1 file: cover blocks become block props, edits and versions are kept', async () => {
    const legacyWorld = (id: string, version: number) => ({
      value: {
        id,
        name: id,
        description: '',
        layout: { halfWidth: 10, halfDepth: 10, obstacles: [{ x: 1, z: 2, width: 3, depth: 1.5, height: 1.25 }], spawnPoints: [{ x: -5, z: 0 }, { x: 5, z: 0 }] },
      },
      version,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        format: 1,
        sections: { rooms: { value: { maxPlayers: 6, worldId: 'yard' }, version: 3, updatedAt: '2026-01-01T00:00:00.000Z' } },
        worlds: [legacyWorld(PROTOTYPE_WORLD.id, 1), legacyWorld('yard', 4)],
      }),
    );
    const service = await serviceWith(new JsonFileSettingsStore(file));
    const yard = service.view().worlds.find((w) => w.value.id === 'yard')!;
    expect(yard.version).toBe(4);
    expect(yard.value.layout).toMatchObject({ theme: 'classic', floor: 'court', regions: [], props: [{ kind: 'block', x: 1, z: 2, width: 3, depth: 1.5, height: 1.25, rotation: 0 }] });
    expect(service.live().world.id).toBe('yard');
    expect(service.live().rooms.maxPlayers).toBe(6);
    // The prototype court keeps its stored (edited) layout; the new built-in worlds are added.
    expect(service.view().worlds.find((w) => w.value.id === PROTOTYPE_WORLD.id)!.value.layout.props).toHaveLength(1);
    expect(service.view().worlds.map((w) => w.value.id)).toContain(DEFAULT_WORLD_ID);
    const saved = JSON.parse(await readFile(file, 'utf8')) as { format: number };
    expect(saved.format).toBe(4);
  });

  it('upgrades a format 2 file: movement gets the default steepest climb, the camera section and hilly world arrive', async () => {
    await (await serviceWith(new JsonFileSettingsStore(file))).updateSection('movement', { ...DEFAULT_SECTIONS.movement, playerSpeed: 7 }, 1);
    const data = JSON.parse(await readFile(file, 'utf8')) as {
      format: number;
      sections: Record<string, { value: Record<string, unknown>; version: number }>;
      worlds: { value: { id: string } }[];
      seededWorlds: string[];
    };
    // As a format 2 file was written: no slope limit, no camera section, no Rolling Hills.
    data.format = 2;
    delete data.sections.movement!.value.maxSlopeDeg;
    delete data.sections.camera;
    data.worlds = data.worlds.filter((w) => w.value.id !== 'rolling-hills');
    data.seededWorlds = data.seededWorlds.filter((id) => id !== 'rolling-hills');
    await writeFile(file, JSON.stringify(data));

    const upgraded = await serviceWith(new JsonFileSettingsStore(file));
    expect(upgraded.live().game.maxSlopeDeg).toBe(DEFAULT_SECTIONS.movement.maxSlopeDeg);
    expect(upgraded.live().game.playerSpeed).toBe(7);
    expect(upgraded.view().sections.movement.version).toBe(2);
    expect(upgraded.live().camera).toEqual(DEFAULT_SECTIONS.camera);
    expect(upgraded.view().worlds.map((w) => w.value.id)).toContain('rolling-hills');
    const saved = JSON.parse(await readFile(file, 'utf8')) as { format: number };
    expect(saved.format).toBe(4);
  });

  it('upgrades a format 3 file: pools name no curriculum, built-in worlds get their own pools, admins’ worlds keep the room-wide one', async () => {
    const first = await serviceWith(new JsonFileSettingsStore(file));
    await first.updateSection('questions', { ...DEFAULT_SECTIONS.questions, subjectIds: ['mathematics'] }, 1);
    await first.saveWorld(arenaWorld('box-yard'), null);
    const data = JSON.parse(await readFile(file, 'utf8')) as {
      format: number;
      sections: Record<string, { value: Record<string, unknown>; version: number }>;
      worlds: { value: { id: string; questions?: unknown }; version: number }[];
    };
    // As a format 3 file was written: pools without curricula, worlds without pools.
    data.format = 3;
    delete data.sections.questions!.value.curriculumIds;
    for (const world of data.worlds) delete world.value.questions;
    await writeFile(file, JSON.stringify(data));

    const upgraded = await serviceWith(new JsonFileSettingsStore(file));
    expect(upgraded.live().questions).toEqual({ curriculumIds: [], levelIds: [], subjectIds: ['mathematics'], difficulty: [1, 5] });
    expect(upgraded.view().sections.questions.version).toBe(2);
    for (const builtin of BUILTIN_WORLDS) expect(upgraded.worldRecord(builtin.id)!.value.questions, builtin.id).toEqual(builtin.questions);
    expect(upgraded.worldRecord('maple-park')!.version).toBe(1);
    expect(upgraded.worldRecord('box-yard')!.value).not.toHaveProperty('questions');
  });

  it('fills sections added since the file was written with their defaults, keeping the rest', async () => {
    await (await serviceWith(new JsonFileSettingsStore(file))).updateSection('combat', { ...DEFAULT_SECTIONS.combat, wrongAnswerDamage: 40 }, 1);
    const data = JSON.parse(await readFile(file, 'utf8')) as { sections: Record<string, unknown> };
    delete data.sections.appearance; // as written before the appearance section existed
    await writeFile(file, JSON.stringify(data));

    const upgraded = await serviceWith(new JsonFileSettingsStore(file));
    expect(upgraded.live().appearance).toEqual(DEFAULT_SECTIONS.appearance);
    expect(upgraded.live().game.wrongAnswerDamage).toBe(40);
    const saved = JSON.parse(await readFile(file, 'utf8')) as { sections: Record<string, { version: number }> };
    expect(saved.sections.appearance!.version).toBe(1);
  });

  it('refuses to start from a file that fails validation', async () => {
    await serviceWith(new JsonFileSettingsStore(file));
    const data = JSON.parse(await readFile(file, 'utf8')) as { sections: { combat: { value: { startingHealth: number } } } };
    data.sections.combat.value.startingHealth = -5;
    await writeFile(file, JSON.stringify(data));
    await expect(serviceWith(new JsonFileSettingsStore(file))).rejects.toThrow(/section combat: startingHealth/);
  });
});
