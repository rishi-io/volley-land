import { DEFAULT_GAME_CONFIG, PROTOTYPE_WORLD } from '@volleyland/game-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SECTIONS } from '../settings/defaults.js';
import type { LiveSettings } from '../settings/settings.service.js';
import { settingsChange } from './settings-change.js';

const running: LiveSettings = {
  game: DEFAULT_GAME_CONFIG,
  rooms: DEFAULT_SECTIONS.rooms,
  questions: DEFAULT_SECTIONS.questions,
  bots: DEFAULT_SECTIONS.bots,
  appearance: DEFAULT_SECTIONS.appearance,
  camera: DEFAULT_SECTIONS.camera,
  world: PROTOTYPE_WORLD,
};

describe('settingsChange', () => {
  it('ignores a save that leaves what players see and play by as it was', () => {
    expect(settingsChange(running, structuredClone(running))).toEqual({ kind: 'none', changes: [] });
    // The world description is admin-only.
    expect(settingsChange(running, { ...running, world: { ...running.world, description: 'new words' } }).kind).toBe('none');
  });

  it('restarts the match when the question pool changes, without listing level or subject IDs', () => {
    const questions = { curriculumIds: [], levelIds: ['in-cbse-class-10'], subjectIds: [], difficulty: [2, 4] as [number, number] };
    expect(settingsChange(running, { ...running, questions })).toEqual({
      kind: 'rules',
      changes: [
        { section: 'questions', key: 'levelIds', from: null, to: null },
        { section: 'questions', key: 'difficulty', from: null, to: null },
      ],
    });
  });

  it("asks from the world's own pool: a room-wide change does not restart a room whose world has one", () => {
    const own = { curriculumIds: ['gb-gcse'], levelIds: [], subjectIds: [], difficulty: [1, 5] as [number, number] };
    const world = { ...running.world, questions: own };
    const roomWide = { ...running.questions, levelIds: ['in-cbse-class-10'] };
    expect(settingsChange({ ...running, world }, { ...running, world, questions: roomWide })).toEqual({ kind: 'none', changes: [] });
    // Giving the world its own pool, or changing it, does.
    expect(settingsChange(running, { ...running, world })).toEqual({
      kind: 'rules',
      changes: [{ section: 'questions', key: 'curriculumIds', from: null, to: null }],
    });
  });

  it('treats an appearance change as presentation only, with the values players see', () => {
    const nameTags = !running.appearance.nameTags;
    expect(settingsChange(running, { ...running, appearance: { ...running.appearance, nameTags } })).toEqual({
      kind: 'presentation',
      changes: [{ section: 'appearance', key: 'nameTags', from: running.appearance.nameTags, to: nameTags }],
    });
    const palette = [...running.appearance.palette].reverse();
    expect(settingsChange(running, { ...running, appearance: { ...running.appearance, palette } }).changes).toEqual([
      { section: 'appearance', key: 'palette', from: null, to: null },
    ]);
  });

  it('treats a camera change as presentation only, alone or with appearance', () => {
    const camera = { ...running.camera, defaultView: 'first-person' as const };
    expect(settingsChange(running, { ...running, camera })).toEqual({
      kind: 'presentation',
      changes: [{ section: 'camera', key: 'defaultView', from: 'third-person', to: 'first-person' }],
    });
    expect(settingsChange(running, { ...running, camera, appearance: { ...running.appearance, nameTags: !running.appearance.nameTags } }).kind).toBe('presentation');
  });

  it('reports rule changes under their admin section, and starts a new match', () => {
    const next = { ...running, game: { ...running.game, playerSpeed: 9, startingHealth: 150 } };
    expect(settingsChange(running, next)).toEqual({
      kind: 'rules',
      changes: [
        { section: 'combat', key: 'startingHealth', from: running.game.startingHealth, to: 150 },
        { section: 'movement', key: 'playerSpeed', from: running.game.playerSpeed, to: 9 },
      ],
    });
  });

  it('starts a new match when appearance changes together with a rule', () => {
    const next = { ...running, game: { ...running.game, playerSpeed: 9 }, appearance: { ...running.appearance, nameTags: !running.appearance.nameTags } };
    expect(settingsChange(running, next).kind).toBe('rules');
  });

  it('names the worlds when the room switches world, and reports edits to the world in use', () => {
    const other = { ...PROTOTYPE_WORLD, id: 'yard', name: 'Yard' };
    expect(settingsChange(running, { ...running, rooms: { ...running.rooms, worldId: 'yard' }, world: other }).changes).toEqual([
      { section: 'rooms', key: 'worldId', from: PROTOTYPE_WORLD.name, to: 'Yard' },
    ]);
    const edited = { ...running.world, name: 'Renamed', layout: { ...running.world.layout, halfWidth: 99 } };
    expect(settingsChange(running, { ...running, world: edited })).toEqual({
      kind: 'rules',
      changes: [
        { section: 'world', key: 'name', from: PROTOTYPE_WORLD.name, to: 'Renamed' },
        { section: 'world', key: 'layout', from: null, to: null },
      ],
    });
  });

  it('reports room size, and says bot behaviour changed without revealing it', () => {
    const next = { ...running, rooms: { ...running.rooms, maxPlayers: 6 }, bots: { ...running.bots, aimErrorDeg: running.bots.aimErrorDeg + 5 } };
    expect(settingsChange(running, next)).toEqual({
      kind: 'rules',
      changes: [
        { section: 'rooms', key: 'maxPlayers', from: running.rooms.maxPlayers, to: 6 },
        { section: 'bots', key: 'aimErrorDeg', from: null, to: null },
      ],
    });
  });
});
