import type { ServerEventName } from '@volleyland/contracts';
import { type Arena, DEFAULT_GAME_CONFIG, type GameConfig, type World, arenaFromLayout, boxCollider, createArena, createRng } from '@volleyland/game-core';
import { contentServiceWith } from '../content-workflow/testing.js';
import { afterEach, describe, expect, it } from 'vitest';
import { type BotConfig, DEFAULT_BOT_CONFIG } from '../config/bot-config.js';
import { seedQuestions } from '../content-workflow/seed.js';
import type { QuestionSelectionService } from '../question-selection/question-selection.service.js';
import { QuestionSelector } from '../question-selection/question-selector.js';
import { seedWith } from '../settings/defaults.js';
import { InMemorySettingsStore } from '../settings/in-memory-settings-store.js';
import { SettingsService } from '../settings/settings.service.js';
import { Bot, type BotMatch, leadPoint } from './bot.js';
import { BotRoster } from './bot-roster.js';
import { Match, type MatchEventSink } from './match.js';
import { RoomRegistry } from './room-registry.service.js';

interface Recorded {
  at: number;
  to: 'room' | string;
  event: ServerEventName;
  payload: Record<string, unknown>;
}

const bank = seedQuestions();
/** Long ranges so a strafing target stays in reach; projectiles leave the narrow Z court quickly, so misses register fast. */
const game: GameConfig = { ...DEFAULT_GAME_CONFIG, spawnProtectionMs: 1, projectileLifetimeMs: 3000 };
/** The human spawns at z = -5 and the bot at z = +5, 10 apart, in a wide but shallow court. */
const openArena: Arena = createArena({
  halfWidth: 200,
  halfDepth: 8,
  spawnPoints: [
    { x: 0, y: 0, z: -5 },
    { x: 0, y: 0, z: 5 },
  ],
});
const tickMs = 1000 / game.tickRate;

/** A bot that stands still and aims perfectly at where the target is, but never leads it. */
const stillBot: BotConfig = {
  ...DEFAULT_BOT_CONFIG,
  moveSpeedFactor: 0,
  aimErrorDeg: 0,
  reactionMs: 0,
  leadTarget: false,
  fireIntervalMs: [1000, 1000],
  maxRangeFactor: 1,
};

function setup(botConfig: BotConfig, arena: Arena = openArena, rules: GameConfig = game) {
  let clock = 1_000_000;
  const events: Recorded[] = [];
  const transport: MatchEventSink = {
    toRoom: (event, payload) => events.push({ at: clock, to: 'room', event, payload: payload as Record<string, unknown> }),
    toPlayer: (playerId, event, payload) => events.push({ at: clock, to: playerId, event, payload: payload as Record<string, unknown> }),
  };
  const now = () => clock;
  const roster = new BotRoster(botConfig, rules, arena, now);
  const match = new Match('m1', rules, arena, new QuestionSelector(bank, createRng(7)), roster.wrap(transport), now);
  roster.attach(match);
  match.addPlayer('p1');
  roster.balance(1, 4);
  match.step();

  let seq = 0;
  /** Advance `ms`, the human strafing along +X (or standing still) every tick. */
  const run = (ms: number, human: { moveX: number } = { moveX: 0 }, until?: () => boolean) => {
    for (let t = 0; t < ms; t += tickMs) {
      clock += tickMs;
      match.queueInput('p1', { seq: seq++, moveX: human.moveX, moveZ: 0, yaw: 0 });
      roster.act();
      match.step();
      if (until?.()) return;
    }
  };
  const of = (event: ServerEventName, to?: string) => events.filter((e) => e.event === event && (to === undefined || e.to === to));
  const botId = roster.ids[0]!;
  const botThrows = () => of('projectile.spawned').filter((e) => e.payload.ownerId === botId);
  const botHits = () => of('hit.confirmed').filter((e) => e.payload.shooterId === botId);
  return { match, roster, botId, events, run, of, botThrows, botHits, now };
}

describe('leadPoint', () => {
  it('aims where a moving target and the projectile meet', () => {
    const from = { x: 0, z: 0 };
    const target = { x: 0, z: 10 };
    const velocity = { x: 6, z: 0 };
    const aim = leadPoint(from, target, velocity, 18);
    const t = Math.hypot(aim.x, aim.z) / 18;
    expect(aim.x).toBeCloseTo(target.x + velocity.x * t, 6);
    expect(aim.z).toBeCloseTo(target.z, 6);
  });

  it('aims straight at a target it cannot catch or that is not moving', () => {
    expect(leadPoint({ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 0, z: 0 }, 18)).toEqual({ x: 0, z: 10 });
    expect(leadPoint({ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 0, z: 30 }, 18)).toEqual({ x: 0, z: 10 });
  });
});

describe('Bot', () => {
  it('misses a strafing player, then lands a telegraphed sure shot after the miss streak', () => {
    const { run, botThrows, botHits } = setup({ ...stillBot, missesBeforeSureShot: 2, sureShotWindupMs: 300 });
    run(8000, { moveX: 1 }, () => botHits().length > 0);

    const throws = botThrows();
    expect(botHits()).toHaveLength(1);
    const hitIndex = throws.findIndex((e) => e.payload.projectileId === botHits()[0]!.payload.projectileId);
    // The throws before it all missed (at least the streak of 2), and the one that hit is the sure shot:
    // it came after a visible pause, later than the normal fire interval.
    expect(hitIndex).toBeGreaterThanOrEqual(2);
    expect(throws[hitIndex]!.at - throws[hitIndex - 1]!.at).toBeGreaterThanOrEqual(1000 + 300);
  });

  it('announces its windup before the sure shot, so clients can warn the target', () => {
    const { run, of, botId, botHits } = setup({ ...stillBot, missesBeforeSureShot: 2, sureShotWindupMs: 300 });
    run(8000, { moveX: 1 }, () => botHits().length > 0);

    const windups = of('bot.windup');
    expect(windups.length).toBeGreaterThanOrEqual(1);
    expect(windups[0]!.payload).toMatchObject({ playerId: botId, targetId: 'p1' });
    expect(windups.at(-1)!.at).toBeLessThanOrEqual(botHits()[0]!.at - 300);
  });

  it('never hits a strafing player when sure shots are disabled', () => {
    const { run, botThrows, botHits } = setup({ ...stillBot, missesBeforeSureShot: 0 });
    run(6000, { moveX: 1 });
    expect(botThrows().length).toBeGreaterThanOrEqual(4);
    expect(botHits()).toHaveLength(0);
  });

  it('walks round cover to reach a player it cannot see', () => {
    // A tall wall between the bot (z = 5) and the human (z = -5), ending 10 m to either side.
    const walled = createArena({
      halfWidth: 30,
      halfDepth: 8,
      colliders: [boxCollider(0, 0, 10, 0.3, 2.5)],
      spawnPoints: [
        { x: 0, y: 0, z: -5 },
        { x: 0, y: 0, z: 5 },
      ],
    });
    const { run, botHits, of, botId } = setup({ ...stillBot, moveSpeedFactor: 1, missesBeforeSureShot: 0 }, walled);
    run(12_000, { moveX: 0 }, () => botHits().length > 0);
    expect(botHits()).toHaveLength(1);
    const bot = (of('state.snapshot').at(-1)!.payload as { players: { id: string; x: number }[] }).players.find((p) => p.id === botId)!;
    expect(Math.abs(bot.x)).toBeGreaterThan(9); // it went round an end of the wall
  });

  it('hits a player who stands still', () => {
    const { run, botHits } = setup({ ...stillBot, missesBeforeSureShot: 0 });
    run(3000, { moveX: 0 }, () => botHits().length > 0);
    expect(botHits()).toHaveLength(1);
  });

  it('answers its own question after the think delay, right or wrong as configured', () => {
    for (const [chance, outcome] of [
      [1, 'correct'],
      [0, 'incorrect'],
    ] as const) {
      const quiet = { ...stillBot, fireIntervalMs: [60_000, 60_000] as [number, number], answerCorrectChance: chance, answerDelayMs: [1000, 1000] as [number, number] };
      const { match, botId, run, of, events, now } = setup(quiet);
      expect(match.requestProjectile('p1', 0)).toEqual({ ok: true });
      run(1000, { moveX: 0 }, () => of('hit.confirmed').length > 0);
      expect(of('hit.confirmed')[0]!.payload.targetId).toBe(botId);
      const hitAt = now();
      // The question goes to the bot only, never out to the transport.
      expect(events.filter((e) => e.to === botId)).toHaveLength(0);

      run(2000);
      const health = of('health.changed').filter((e) => e.payload.playerId === botId);
      if (outcome === 'incorrect') {
        expect(health).toHaveLength(1);
        expect(health[0]!.at - hitAt).toBeGreaterThanOrEqual(1000 - tickMs);
        expect(health[0]!.payload).toMatchObject({ delta: -game.wrongAnswerDamage, reason: 'incorrect' });
      } else {
        expect(health).toHaveLength(0);
        const snapshot = of('state.snapshot').at(-1)!.payload as { players: { id: string; status: string; health: number }[] };
        expect(snapshot.players.find((p) => p.id === botId)).toMatchObject({ status: 'alive', health: game.startingHealth });
      }
    }
  });
});

describe('RoomRegistry with bots', () => {
  let registry: RoomRegistry;
  afterEach(() => registry.onModuleDestroy());

  /** Same shape as the bot-test arena, within the world builder's size limits. */
  const world: World = {
    id: 'shallow-court',
    name: 'Shallow court',
    description: '',
    layout: { halfWidth: 100, halfDepth: 8, theme: 'classic', floor: 'court', scatter: 0, regions: [], props: [], spawnPoints: [{ x: 0, z: -5 }, { x: 0, z: 5 }] },
  };
  const questions = { forMatch: () => new QuestionSelector(bank, createRng(3)) } as unknown as QuestionSelectionService;

  async function make(maxPlayers: number, bots: BotConfig, sink: MatchEventSink = { toRoom: () => {}, toPlayer: () => {} }) {
    const seed = seedWith({ game, sections: { rooms: { maxPlayers, worldId: world.id }, bots }, worlds: [world] });
    const settings = new SettingsService(new InMemorySettingsStore(), seed, { devRoomCode: 'DEV' }, await contentServiceWith());
    await settings.load();
    registry = new RoomRegistry(settings, questions);
    registry.useSinkFactory(() => sink);
    return registry;
  }

  it('fills empty seats with bots and hands a bot seat to each human who joins', async () => {
    const rooms = await make(2, { ...DEFAULT_BOT_CONFIG, fillRoomTo: 2 });
    expect(rooms.join('DEV', 'h1')).toMatchObject({ ok: true });
    expect(rooms.botsIn('DEV')).toHaveLength(1);
    expect(rooms.matchFor('DEV')!.playerCount).toBe(2);

    expect(rooms.join('DEV', 'h2')).toMatchObject({ ok: true });
    expect(rooms.botsIn('DEV')).toHaveLength(0);
    expect(rooms.join('DEV', 'h3')).toMatchObject({ ok: false, code: 'room_full' });

    rooms.leave('DEV', 'h2');
    expect(rooms.botsIn('DEV')).toHaveLength(1);
    rooms.leave('DEV', 'h1');
    expect(rooms.matchFor('DEV')).toBeNull(); // bots do not keep a room open
  });

  it('never seats more bots than maxPlayers allows, and none when disabled', async () => {
    const rooms = await make(3, { ...DEFAULT_BOT_CONFIG, fillRoomTo: 6 });
    rooms.join('DEV', 'h1');
    expect(rooms.botsIn('DEV')).toHaveLength(2);
    rooms.onModuleDestroy();

    const none = await make(4, { ...DEFAULT_BOT_CONFIG, fillRoomTo: 0 });
    none.join('DEV', 'h1');
    expect(none.botsIn('DEV')).toHaveLength(0);
  });

  it('steps bots with the room, so a lone human gets thrown at', async () => {
    const spawnedBy: string[] = [];
    const rooms = await make(2, { ...stillBot, fillRoomTo: 2 }, {
      toRoom: (event, payload) => {
        if (event === 'projectile.spawned') spawnedBy.push((payload as { ownerId: string }).ownerId);
      },
      toPlayer: () => {},
    });
    let clock = 1_000_000;
    rooms.now = () => clock;
    rooms.join('DEV', 'h1');
    for (let t = 0; t < 2500; t += tickMs) {
      clock += tickMs;
      rooms.stepAll();
    }
    expect(spawnedBy.length).toBeGreaterThanOrEqual(1);
    expect(new Set(spawnedBy)).toEqual(new Set(['bot-1']));
  });
});

describe('Bot on hilly ground', () => {
  it('aims up the hill at a player standing on it, and hits', () => {
    // The human spawns on a broad hill at z = -5; the bot below it at z = +5.
    const hill = arenaFromLayout({
      halfWidth: 30,
      halfDepth: 12,
      theme: 'park',
      floor: 'grass',
      scatter: 0,
      regions: [],
      props: [],
      spawnPoints: [
        { x: 0, z: -5 },
        { x: 0, z: 5 },
      ],
      hills: [{ x: 0, z: -6, width: 14, depth: 14, rotation: 0, height: 2.5, plateau: 0.5 }],
    });
    const { run, botThrows, botHits } = setup(stillBot, hill);
    run(3000, { moveX: 0 }, () => botHits().length > 0);
    expect((botThrows()[0]!.payload as { vy: number }).vy).toBeGreaterThan(0);
    expect(botHits().length).toBeGreaterThan(0);
  });
});

describe('Bot weapons', () => {
  it('switches to a weapon that reaches the target, and fires it once the switch is done', () => {
    // The ball reaches under 2 m, so at 10 m only the blaster or the rail will do.
    const rules: GameConfig = { ...game, projectileLifetimeMs: 100, scatterEnabled: false };
    const { run, botThrows } = setup(stillBot, openArena, rules);
    run(4000, { moveX: 0 }, () => botThrows().length > 0);
    const [shot] = botThrows();
    expect(['blaster', 'rail']).toContain(shot!.payload.weapon);
  });

  it('counts a scatter fan that misses as one miss', () => {
    const match: BotMatch = {
      queueInput: () => ({ ok: true }),
      requestProjectile: () => ({ ok: true }),
      selectWeapon: () => ({ ok: true }),
      submitAnswer: () => ({ ok: true }),
      answerKeyFor: () => null,
      announceWindup: () => ({ ok: true }),
    };
    const bot = new Bot('bot-1', match, stillBot, game, openArena, () => 0);
    const envelope = { v: 8, matchId: 'm1', msgId: 'x', serverTime: 0 };
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      bot.observe('projectile.spawned', { ...envelope, tick: 3, projectileId: id, ownerId: 'bot-1', weapon: 'scatter', x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 1 });
    }
    bot.observe('state.snapshot', { ...envelope, tick: 4, players: [], projectiles: [{ id: 'e', x: 0, y: 1, z: 2, weapon: 'scatter' }] });
    expect(bot.misses).toBe(0);
    bot.observe('state.snapshot', { ...envelope, tick: 5, players: [], projectiles: [] });
    expect(bot.misses).toBe(1);
  });
});
