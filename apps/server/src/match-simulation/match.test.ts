import type { QuestionPresented, ServerEventName } from '@volleyland/contracts';
import { type Arena, DEFAULT_GAME_CONFIG, type GameConfig, arenaFromLayout, boxCollider, createArena, createRng, distance, groundHeight } from '@volleyland/game-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedQuestions } from '../content-workflow/seed.js';
import { QuestionSelector } from '../question-selection/question-selector.js';
import { Match, type MatchEventSink } from './match.js';

interface Recorded {
  to: 'room' | string;
  event: ServerEventName;
  payload: Record<string, unknown>;
}

const bank = seedQuestions();
const config: GameConfig = { ...DEFAULT_GAME_CONFIG };
/** Open court, players spawned 6 units apart facing each other along Z. */
const arena: Arena = createArena({
  halfWidth: 15,
  halfDepth: 15,
  spawnPoints: [
    { x: 0, y: 0, z: -3 },
    { x: 0, y: 0, z: 3 },
  ],
});

let clock: number;
let events: Recorded[];
let match: Match;

const sink: MatchEventSink = {
  toRoom: (event, payload) => events.push({ to: 'room', event, payload: payload as Record<string, unknown> }),
  toPlayer: (playerId, event, payload) => events.push({ to: playerId, event, payload: payload as Record<string, unknown> }),
};

const of = (event: ServerEventName, to?: string) => events.filter((e) => e.event === event && (to === undefined || e.to === to));
const lastSnapshot = () => of('state.snapshot').at(-1)!.payload as { players: { id: string; health: number; status: string; protected: boolean; x: number; z: number; lastInputSeq: number }[] };
const player = (id: string) => lastSnapshot().players.find((p) => p.id === id)!;

function advance(ms: number): void {
  const ticks = Math.ceil(ms / (1000 / config.tickRate));
  for (let i = 0; i < ticks; i++) {
    clock += 1000 / config.tickRate;
    match.step();
  }
}

/** p1 throws at p2 and the server confirms the hit; returns the question p2 was shown. */
function hitP2(): QuestionPresented {
  const before = of('question.presented', 'p2').length;
  expect(match.requestProjectile('p1', 0)).toEqual({ ok: true });
  advance(500);
  const presented = of('question.presented', 'p2');
  expect(presented.length).toBe(before + 1);
  return presented.at(-1)!.payload as unknown as QuestionPresented;
}

const answerKey = (q: QuestionPresented) => bank.find((b) => b.prompt === q.prompt)!.correctOptionId;
const wrongOption = (q: QuestionPresented) => q.options.find((o) => o.id !== answerKey(q))!.id;

beforeEach(() => {
  clock = 1_000_000;
  events = [];
  match = new Match('m1', config, arena, new QuestionSelector(bank, createRng(11)), sink, () => clock);
  match.addPlayer('p1');
  match.addPlayer('p2');
  advance(config.spawnProtectionMs + 50); // let spawn protection lapse
});

describe('Match: the server-decided question-hit loop', () => {
  it('spawns players at separate points with full health', () => {
    expect(player('p1')).toMatchObject({ health: 100, status: 'alive', z: -3 });
    expect(player('p2')).toMatchObject({ health: 100, status: 'alive', z: 3 });
  });

  it('a hit freezes and protects the target and shows the question only to the target', () => {
    const question = hitP2();
    expect(of('hit.confirmed')[0]!.payload).toMatchObject({ shooterId: 'p1', targetId: 'p2' });
    expect(player('p2')).toMatchObject({ status: 'frozen', protected: true });
    expect(of('question.presented', 'p1')).toHaveLength(0);
    expect(of('question.presented', 'room')).toHaveLength(0);
    expect(JSON.stringify(question)).not.toContain('correct');
    expect(question.deadline).toBe(question.serverTime + config.answerTimeMs);
  });

  it('a correct answer costs no health and grants the shield', () => {
    const question = hitP2();
    expect(match.submitAnswer('p2', question.encounterId, answerKey(question))).toEqual({ ok: true });
    expect(of('question.resolved', 'p2').at(-1)!.payload).toMatchObject({ outcome: 'correct', correctOptionId: answerKey(question) });
    expect(of('health.changed')).toHaveLength(0);
    advance(50);
    expect(player('p2')).toMatchObject({ status: 'alive', protected: true, health: 100 });

    // Shielded: a throw now passes through without a hit.
    match.requestProjectile('p1', 0);
    advance(500);
    expect(of('hit.confirmed')).toHaveLength(1);

    advance(config.correctAnswerShieldMs);
    expect(player('p2').protected).toBe(false);
  });

  it('a wrong answer costs 25 health and accepts no second answer', () => {
    const question = hitP2();
    expect(match.submitAnswer('p2', question.encounterId, wrongOption(question))).toEqual({ ok: true });
    expect(match.submitAnswer('p2', question.encounterId, answerKey(question))).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(of('health.changed').at(-1)!.payload).toMatchObject({ playerId: 'p2', health: 75, delta: -25, reason: 'incorrect' });
    expect(of('question.resolved', 'p2')).toHaveLength(1);
    advance(50);
    expect(player('p2')).toMatchObject({ status: 'alive', health: 75 });
  });

  it('only the target can answer, and only its own encounter', () => {
    const question = hitP2();
    expect(match.submitAnswer('p1', question.encounterId, answerKey(question))).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(match.submitAnswer('p2', 'm1:e999', answerKey(question))).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('no answer by the server deadline is a timeout and costs 25 health', () => {
    hitP2();
    advance(config.answerTimeMs);
    expect(of('question.resolved', 'p2').at(-1)!.payload).toMatchObject({ outcome: 'timeout', selectedOptionId: null });
    expect(of('health.changed').at(-1)!.payload).toMatchObject({ health: 75, reason: 'timeout' });
  });

  it('four wrong answers kill; the player respawns after 4 s with full health and spawn protection', () => {
    for (let i = 0; i < 4; i++) {
      const question = hitP2();
      match.submitAnswer('p2', question.encounterId, wrongOption(question));
      advance(config.projectileCooldownMs);
    }
    expect(player('p2')).toMatchObject({ status: 'dead', health: 0 });
    expect(match.requestProjectile('p2', Math.PI)).toMatchObject({ ok: false, code: 'not_allowed' });

    advance(config.respawnMs);
    expect(of('player.respawned').at(-1)!.payload).toMatchObject({ playerId: 'p2', health: 100 });
    expect(of('health.changed').at(-1)!.payload).toMatchObject({ playerId: 'p2', health: 100, reason: 'respawn' });
    expect(player('p2')).toMatchObject({ status: 'alive', health: 100, protected: true });
  });

  it('frozen players cannot move or throw, but their inputs are acknowledged', () => {
    hitP2();
    const before = player('p2');
    match.queueInput('p2', { seq: 50, moveX: 1, moveZ: 0, yaw: 0 });
    expect(match.requestProjectile('p2', Math.PI)).toMatchObject({ ok: false, code: 'not_allowed' });
    advance(50);
    expect(player('p2')).toMatchObject({ x: before.x, z: before.z, lastInputSeq: 50 });
  });
});

describe('Match: movement and projectile validation', () => {
  it('caps movement to real time no matter how many inputs arrive', () => {
    const start = { ...player('p1'), y: 0 };
    let seq = 0;
    for (let tick = 0; tick < 10; tick++) {
      for (let i = 0; i < 20; i++) match.queueInput('p1', { seq: seq++, moveX: 1, moveZ: 0, yaw: 0 });
      advance(50);
    }
    const end = { ...player('p1'), y: 0 };
    const stepDistance = config.playerSpeed * (config.inputStepMs / 1000);
    expect(distance(start, end)).toBeLessThanOrEqual(stepDistance * (10 + config.maxInputCredits) + 1e-9);
  });

  it('enforces the throw cooldown', () => {
    expect(match.requestProjectile('p1', Math.PI)).toEqual({ ok: true });
    expect(match.requestProjectile('p1', Math.PI)).toMatchObject({ ok: false, code: 'rate_limited' });
    advance(config.projectileCooldownMs);
    expect(match.requestProjectile('p1', Math.PI)).toEqual({ ok: true });
  });

  it('props stop projectiles, but low ones are thrown over', () => {
    const behind = (height: number) => createArena({ ...arena, colliders: [boxCollider(0, 0, 2, 0.5, height)] });
    const blocked = new Match(
      'm2',
      config,
      behind(3),
      new QuestionSelector(bank, createRng(1)),
      sink,
      () => clock,
    );
    blocked.addPlayer('a');
    blocked.addPlayer('b');
    clock += config.spawnProtectionMs + 1;
    events = [];
    blocked.requestProjectile('a', 0);
    for (let i = 0; i < 20; i++) blocked.step();
    expect(of('hit.confirmed')).toHaveLength(0);

    const low = new Match('m2b', config, behind(0.8), new QuestionSelector(bank, createRng(1)), sink, () => clock);
    low.addPlayer('a');
    low.addPlayer('b');
    clock += config.spawnProtectionMs + 1;
    events = [];
    low.requestProjectile('a', 0);
    for (let i = 0; i < 20; i++) low.step();
    expect(of('hit.confirmed')).toHaveLength(1);
  });

  it('spawns players near the action but out of throwing range', () => {
    // Spawn points along x; the first player takes the first point (x = -60).
    const line = createArena({ halfWidth: 70, halfDepth: 10, spawnPoints: [-60, -40, -20, 0, 60].map((x) => ({ x, y: 0, z: 0 })) });
    const spread = new Match('m4', config, line, new QuestionSelector(bank, createRng(1)), sink, () => clock);
    spread.addPlayer('a');
    spread.addPlayer('b');
    spread.step();
    const xs = (events.filter((e) => e.event === 'state.snapshot').at(-1)!.payload as { players: { x: number }[] }).players.map((p) => p.x);
    // Range is 27 m: x = -40 is too close; -20 is the nearest point out of range (not the farthest, 60).
    expect(xs).toEqual([-60, -20]);
  });

  it('spawn protection blocks hits right after joining', () => {
    const fresh = new Match('m3', config, arena, new QuestionSelector(bank, createRng(1)), sink, () => clock);
    fresh.addPlayer('a');
    fresh.addPlayer('b');
    events = [];
    fresh.requestProjectile('a', 0);
    for (let i = 0; i < 10; i++) fresh.step();
    expect(of('hit.confirmed')).toHaveLength(0);
  });
});

describe('Match: weapons', () => {
  const spawnedBy = (owner: string) => of('projectile.spawned').filter((e) => e.payload.ownerId === owner).map((e) => e.payload as { weapon: string; vx: number; vz: number });

  it('everyone starts with the ball, and snapshots show the weapon in hand', () => {
    expect(player('p1')).toMatchObject({ weapon: 'ball' });
    expect(match.selectWeapon('p1', 'rail')).toEqual({ ok: true });
    advance(50);
    expect(player('p1')).toMatchObject({ weapon: 'rail' });
    expect(player('p2')).toMatchObject({ weapon: 'ball' });
  });

  it('a new weapon fires once the switch time has passed, at its own speed', () => {
    events = [];
    match.selectWeapon('p1', 'blaster');
    expect(match.requestProjectile('p1', 0)).toMatchObject({ ok: false, code: 'rate_limited' });
    advance(config.weaponSwitchMs);
    expect(match.requestProjectile('p1', 0)).toEqual({ ok: true });
    const [shot] = spawnedBy('p1');
    expect(shot).toMatchObject({ weapon: 'blaster' });
    expect(Math.hypot(shot!.vx, shot!.vz)).toBeCloseTo(config.blasterSpeed);
  });

  it('each weapon keeps its own reload, so switching cannot skip one', () => {
    match.selectWeapon('p1', 'rail');
    advance(config.weaponSwitchMs);
    expect(match.requestProjectile('p1', 0)).toEqual({ ok: true });
    match.selectWeapon('p1', 'ball');
    match.selectWeapon('p1', 'rail');
    advance(config.weaponSwitchMs);
    expect(match.requestProjectile('p1', 0)).toMatchObject({ ok: false, code: 'rate_limited' });
    match.selectWeapon('p1', 'ball');
    advance(config.weaponSwitchMs);
    expect(match.requestProjectile('p1', 0)).toEqual({ ok: true });
  });

  it('a scatter shot fans its bolts, and only one question comes of it', () => {
    events = [];
    match.selectWeapon('p1', 'scatter');
    advance(config.weaponSwitchMs);
    expect(match.requestProjectile('p1', 0)).toEqual({ ok: true });
    const fan = spawnedBy('p1');
    expect(fan).toHaveLength(config.scatterPellets);
    const yaws = fan.map((p) => Math.atan2(p.vx, p.vz) * (180 / Math.PI));
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeCloseTo(config.scatterSpreadDeg);
    advance(500);
    expect(of('hit.confirmed')).toHaveLength(1);
    expect(of('question.presented', 'p2')).toHaveLength(1);
  });

  it('the rail reaches past the ball', () => {
    const far = createArena({ halfWidth: 40, halfDepth: 40, spawnPoints: [{ x: 0, y: 0, z: -18 }, { x: 0, y: 0, z: 18 }] });
    const shoot = (weapon: 'ball' | 'rail') => {
      const m = new Match('mw', config, far, new QuestionSelector(bank, createRng(1)), sink, () => clock);
      m.addPlayer('a');
      m.addPlayer('b');
      m.selectWeapon('a', weapon);
      clock += config.spawnProtectionMs + 1;
      events = [];
      expect(m.requestProjectile('a', 0)).toEqual({ ok: true });
      for (let i = 0; i < 60; i++) {
        clock += 50;
        m.step();
      }
      return of('hit.confirmed').length;
    };
    expect(shoot('ball')).toBe(0);
    expect(shoot('rail')).toBe(1);
  });

  it('refuses a weapon the admin turned off', () => {
    const noRail = new Match('mr', { ...config, railEnabled: false }, arena, new QuestionSelector(bank, createRng(1)), sink, () => clock);
    noRail.addPlayer('a');
    expect(noRail.selectWeapon('a', 'rail')).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(noRail.selectWeapon('a', 'scatter')).toEqual({ ok: true });
  });
});

describe('Match: throws wait behind earlier inputs', () => {
  it('a throw sent after movement leaves from where that movement put the player', () => {
    // Three steps along +x arrive with the throw; the server only has credit for them over the next ticks.
    const start = player('p1').x;
    events = [];
    for (let seq = 100; seq < 103; seq++) match.queueInput('p1', { seq, moveX: 1, moveZ: 0, yaw: 0 });
    expect(match.requestProjectile('p1', 0, 0)).toEqual({ ok: true });
    expect(of('projectile.spawned')).toHaveLength(0);
    advance(200);
    const spawned = of('projectile.spawned')[0]!.payload as { x: number };
    expect(spawned.x).toBeCloseTo(start + 3 * config.playerSpeed * (config.inputStepMs / 1000));
    // The cooldown still counts from when the throw was asked for.
    expect(match.requestProjectile('p1', 0, 0)).toMatchObject({ ok: false, code: 'rate_limited' });
  });

  it('a throw still waiting is dropped if the player is hit first', () => {
    events = [];
    // p1's throw lands on p2 within a few ticks; p2's throw waits behind a long backlog of inputs.
    expect(match.requestProjectile('p1', 0, 0)).toEqual({ ok: true });
    advance(150);
    for (let seq = 300; seq < 308; seq++) match.queueInput('p2', { seq, moveX: 0, moveZ: 0, yaw: 0 });
    expect(match.requestProjectile('p2', Math.PI, 0)).toEqual({ ok: true });
    advance(1000);
    expect(of('hit.confirmed')).toHaveLength(1);
    expect(of('projectile.spawned').filter((e) => e.payload.ownerId === 'p2')).toHaveLength(0);
  });
});

describe('Match: terrain', () => {
  /** Two spawn points 12 m apart along z, with a hill (or hollow) of `height` between or under them. */
  const hilly = (hills: { x: number; z: number; width: number; depth: number; height: number }[]) =>
    arenaFromLayout({
      halfWidth: 15,
      halfDepth: 15,
      theme: 'park',
      floor: 'grass',
      scatter: 0,
      regions: [],
      props: [],
      spawnPoints: [
        { x: 0, z: -6 },
        { x: 0, z: 6 },
      ],
      hills: hills.map((h) => ({ ...h, rotation: 0, plateau: 0.5 })),
    });
  const play = (terrain: Arena, yaw: number, pitch: number) => {
    const m = new Match('mt', config, terrain, new QuestionSelector(bank, createRng(1)), sink, () => clock);
    m.addPlayer('a');
    m.addPlayer('b');
    clock += config.spawnProtectionMs + 1;
    events = [];
    expect(m.requestProjectile('a', yaw, pitch)).toEqual({ ok: true });
    for (let i = 0; i < 30; i++) m.step();
    return m;
  };

  it('a hill between two players stops a level throw', () => {
    play(hilly([{ x: 0, z: 0, width: 8, depth: 8, height: 3 }]), 0, 0);
    expect(of('hit.confirmed')).toHaveLength(0);
  });

  it('players stand on the ground, and a throw aimed up the hill hits someone standing on it', () => {
    const terrain = hilly([{ x: 0, z: 6, width: 14, depth: 14, height: 3 }]);
    expect(terrain.spawnPoints[1]!.y).toBeCloseTo(3);
    // Thrown level, it flies into the hillside; aimed up at the target's hand height, it lands.
    play(terrain, 0, 0);
    expect(of('hit.confirmed')).toHaveLength(0);
    const rise = groundHeight(terrain, 0, 6) - groundHeight(terrain, 0, -6);
    play(terrain, 0, Math.atan2(rise, 12));
    expect(of('hit.confirmed')).toHaveLength(1);
  });

  it('reports projectiles in 3D, with the pitch limited to a steep throw', () => {
    const m = new Match('mp', config, arena, new QuestionSelector(bank, createRng(1)), sink, () => clock);
    m.addPlayer('a');
    events = [];
    m.requestProjectile('a', 0, 10);
    const spawned = of('projectile.spawned')[0]!.payload as { y: number; vy: number; vz: number };
    expect(spawned.vy).toBeCloseTo(config.projectileSpeed * Math.sin(1.2));
    expect(spawned.vz).toBeCloseTo(config.projectileSpeed * Math.cos(1.2));
    expect(spawned.y).toBeGreaterThan(config.projectileHeight);
    m.step();
    const snapshot = of('state.snapshot').at(-1)!.payload as { projectiles: { y: number }[] };
    expect(snapshot.projectiles[0]!.y).toBeGreaterThan(spawned.y);
  });
});

describe('Match: player looks', () => {
  it('gives each player the lowest free look, reuses a freed one, and flags bots', () => {
    match.addPlayer('b1', { bot: true });
    advance(50);
    const looks = () => Object.fromEntries((lastSnapshot().players as unknown as { id: string; look: number; bot: boolean }[]).map((p) => [p.id, [p.look, p.bot]]));
    expect(looks()).toEqual({ p1: [0, false], p2: [1, false], b1: [2, true] });
    match.removePlayer('p2');
    match.addPlayer('p3');
    advance(50);
    expect(looks()).toEqual({ p1: [0, false], b1: [2, true], p3: [1, false] });
  });
});

describe('Match: bot windup', () => {
  it('announces a bot lining up a sure shot to the room, and refuses anyone but a live bot', () => {
    match.addPlayer('b1', { bot: true });
    expect(match.announceWindup('b1', 'p1')).toEqual({ ok: true });
    expect(of('bot.windup').map((e) => [e.to, e.payload.playerId, e.payload.targetId])).toEqual([['room', 'b1', 'p1']]);

    expect(match.announceWindup('p2', 'p1').ok).toBe(false);
    expect(match.announceWindup('b1', 'nobody').ok).toBe(false);
    expect(of('bot.windup')).toHaveLength(1);
  });
});
