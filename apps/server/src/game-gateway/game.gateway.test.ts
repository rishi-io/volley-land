import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  type ClientToServerEvents,
  type CommandAck,
  GAME_SOCKET_PATH,
  type MatchSetupMessage,
  PROTOCOL_VERSION,
  type QuestionPresented,
  type RoomJoinAccepted,
  type ServerEventName,
  type ServerToClientEvents,
  type StateSnapshot,
  serverMessageSchemas,
} from '@volleyland/contracts';
import { DEFAULT_GAME_CONFIG, type World } from '@volleyland/game-core';
import { type Socket as ClientSocket, io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { DEFAULT_BOT_CONFIG } from '../config/bot-config.js';
import { DEFAULT_SECTIONS, SETTINGS_SEED, seedWith } from '../settings/defaults.js';
import { InMemorySettingsStore } from '../settings/in-memory-settings-store.js';
import { SETTINGS_STORE } from '../settings/settings-store.js';
import { SettingsService } from '../settings/settings.service.js';
import { seedQuestions } from '../content-workflow/seed.js';
import { CONTENT_STORE } from '../content-workflow/content-store.js';
import { InMemoryContentStore } from '../content-workflow/in-memory-content-store.js';

type GameSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

interface Player {
  socket: GameSocket;
  seq: number;
  joined: RoomJoinAccepted;
  received: { event: ServerEventName; payload: unknown }[];
  invalid: string[];
}

/** Open court with the two spawn points facing each other along Z. */
const testWorld: World = {
  id: 'test-court',
  name: 'Test court',
  description: '',
  layout: {
    halfWidth: 15,
    halfDepth: 15,
    theme: 'classic',
    floor: 'court',
    scatter: 0,
    regions: [],
    props: [],
    spawnPoints: [
      { x: 0, z: -3 },
      { x: 0, z: 3 },
    ],
  },
};
const testConfig = { ...DEFAULT_GAME_CONFIG, spawnProtectionMs: 100 };
const bank = seedQuestions();

let app: INestApplication;
let url: string;
const sockets: GameSocket[] = [];

function connect(): Promise<GameSocket> {
  const socket: GameSocket = io(url, { path: GAME_SOCKET_PATH, transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

async function joinAs(roomCode = 'DEV'): Promise<Player> {
  const socket = await connect();
  const player = { socket, seq: 0, received: [], invalid: [] } as unknown as Player;
  // Record every server event and check it against the shared contract.
  socket.onAny((event: ServerEventName, payload: unknown) => {
    player.received.push({ event, payload });
    const schema = serverMessageSchemas[event];
    if (!schema || !schema.safeParse(payload).success) player.invalid.push(event);
  });
  const ack = await socket.emitWithAck('room.join', { v: PROTOCOL_VERSION, matchId: null, msgId: randomUUID(), seq: player.seq++, roomCode });
  if (!ack.ok) throw new Error(`join failed: ${ack.code}`);
  player.joined = ack;
  return player;
}

const command = (player: Player, extra: object) => ({
  v: PROTOCOL_VERSION,
  matchId: player.joined.matchId,
  msgId: randomUUID(),
  seq: player.seq++,
  ...extra,
});

function waitFor<T>(player: Player, event: ServerEventName, predicate: (payload: T) => boolean = () => true, timeoutMs = 3000): Promise<T> {
  const seen = player.received.find((r) => r.event === event && predicate(r.payload as T));
  if (seen) return Promise.resolve(seen.payload as T);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    const listener = (name: string, payload: unknown) => {
      if (name !== event || !predicate(payload as T)) return;
      clearTimeout(timer);
      player.socket.offAny(listener);
      resolve(payload as T);
    };
    player.socket.onAny(listener);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const answerKey = (q: QuestionPresented) => bank.find((b) => b.prompt === q.prompt)!.correctOptionId;

beforeAll(async () => {
  process.env.DEV_ROOM_CODE = 'DEV';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SETTINGS_STORE)
    .useValue(new InMemorySettingsStore())
    .overrideProvider(CONTENT_STORE)
    .useValue(new InMemoryContentStore())
    .overrideProvider(SETTINGS_SEED)
    .useValue(
      seedWith({
        game: testConfig,
        sections: { rooms: { maxPlayers: 2, worldId: testWorld.id }, bots: { ...DEFAULT_BOT_CONFIG, fillRoomTo: 0 } }, // two humans, no bots
        worlds: [testWorld],
      }),
    )
    .compile();
  app = moduleRef.createNestApplication();
  await app.listen(0);
  url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await app.close();
});

describe('GameGateway on /ws (Phase 0 exit bar)', () => {
  let a: Player;
  let b: Player;

  it('admits two clients into one dev room and hands them the server config', async () => {
    a = await joinAs();
    b = await joinAs();
    expect(a.joined.matchId).toBe(b.joined.matchId);
    expect(a.joined.playerId).not.toBe(b.joined.playerId);
    expect(a.joined.setup).toEqual({
      config: testConfig,
      world: { id: testWorld.id, name: testWorld.name, layout: testWorld.layout },
      appearance: DEFAULT_SECTIONS.appearance,
      camera: DEFAULT_SECTIONS.camera,
    });
  });

  it('refuses a third player and unknown rooms', async () => {
    const extra = await connect();
    let seq = 0;
    const join = (roomCode: string) =>
      extra.emitWithAck('room.join', { v: PROTOCOL_VERSION, matchId: null, msgId: randomUUID(), seq: seq++, roomCode });
    expect(await join('DEV')).toMatchObject({ ok: false, code: 'room_full' });
    expect(await join('NOPE')).toMatchObject({ ok: false, code: 'unknown_room' });
  });

  it('rejects commands before joining', async () => {
    const stranger = await connect();
    const ack = await stranger.emitWithAck('player.input', {
      v: PROTOCOL_VERSION, matchId: a.joined.matchId, msgId: randomUUID(), seq: 1, moveX: 0, moveZ: 0, yaw: 0,
    });
    expect(ack).toMatchObject({ ok: false, code: 'not_in_room' });
  });

  it('rejects invalid payloads, wrong versions, wrong matches and stale sequences', async () => {
    const send = (payload: object): Promise<CommandAck> => a.socket.emitWithAck('player.input', payload as never);
    expect(await send(command(a, { moveX: 5, moveZ: 0, yaw: 0 }))).toMatchObject({ code: 'invalid_payload' });
    expect(await send({ ...command(a, { moveX: 0, moveZ: 0, yaw: 0 }), v: 99 })).toMatchObject({ code: 'protocol_mismatch' });
    expect(await send({ ...command(a, { moveX: 0, moveZ: 0, yaw: 0 }), matchId: 'other' })).toMatchObject({ code: 'wrong_match' });
    expect(await send(command(a, { moveX: 0, moveZ: 0, yaw: 0 }))).toEqual({ ok: true });
    expect(await send({ ...command(a, { moveX: 0, moveZ: 0, yaw: 0 }), seq: 1 })).toMatchObject({ code: 'stale_sequence' });
  });

  it('rate-limits player.input floods', async () => {
    await sleep(500); // refill the bucket used above
    const acks = await Promise.all(
      Array.from({ length: 40 }, () => a.socket.emitWithAck('player.input', command(a, { moveX: 0, moveZ: 0, yaw: 0 }))),
    );
    expect(acks.some((ack) => !ack.ok && ack.code === 'rate_limited')).toBe(true);
  });

  it('runs the question-hit loop with the server deciding every outcome', async () => {
    await sleep(testConfig.spawnProtectionMs + 100);

    // Wrong answer: 25 damage, decided by the server.
    expect(await a.socket.emitWithAck('projectile.request', command(a, { yaw: 0, pitch: 0 }))).toEqual({ ok: true });
    const hit = await waitFor<{ targetId: string; encounterId: string }>(a, 'hit.confirmed');
    expect(hit.targetId).toBe(b.joined.playerId);
    const first = await waitFor<QuestionPresented>(b, 'question.presented', (q) => q.encounterId === hit.encounterId);
    expect(a.received.some((r) => r.event === 'question.presented')).toBe(false);

    const wrong = first.options.find((o) => o.id !== answerKey(first))!.id;
    expect(await b.socket.emitWithAck('question.answer', command(b, { encounterId: first.encounterId, optionId: wrong }))).toEqual({ ok: true });
    expect(await b.socket.emitWithAck('question.answer', command(b, { encounterId: first.encounterId, optionId: answerKey(first) }))).toMatchObject({
      ok: false,
      code: 'not_allowed',
    });
    const resolved = await waitFor<{ outcome: string; correctOptionId: string | null }>(b, 'question.resolved');
    expect(resolved).toMatchObject({ outcome: 'incorrect', correctOptionId: answerKey(first) });
    const damage = await waitFor<{ playerId: string; health: number }>(a, 'health.changed');
    expect(damage).toMatchObject({ playerId: b.joined.playerId, health: 75 });

    // Correct answer: no damage.
    await sleep(testConfig.projectileCooldownMs);
    expect(await a.socket.emitWithAck('projectile.request', command(a, { yaw: 0, pitch: 0 }))).toEqual({ ok: true });
    const second = await waitFor<QuestionPresented>(b, 'question.presented', (q) => q.encounterId !== first.encounterId);
    expect(await b.socket.emitWithAck('question.answer', command(b, { encounterId: second.encounterId, optionId: answerKey(second) }))).toEqual({ ok: true });
    await waitFor<{ encounterId: string; outcome: string }>(b, 'question.resolved', (r) => r.encounterId === second.encounterId && r.outcome === 'correct');
    const snapshot = await waitFor<{ players: { id: string; health: number }[] }>(a, 'state.snapshot', (s) =>
      s.players.some((p) => p.id === b.joined.playerId && p.health === 75),
    );
    expect(snapshot.players).toHaveLength(2);
  });

  it('starts a new match with the same players as soon as an admin changes the rules', async () => {
    const settings = app.get(SettingsService);
    const oldMatchId = a.joined.matchId;
    const combat = settings.view().sections.combat;
    await settings.updateSection('combat', { ...combat.value, startingHealth: 150 }, combat.version);

    const setup = await waitFor<MatchSetupMessage>(a, 'match.setup', (m) => m.matchId !== oldMatchId);
    expect(setup.setup.config.startingHealth).toBe(150);
    expect(setup.changes).toEqual([{ section: 'combat', key: 'startingHealth', from: testConfig.startingHealth, to: 150 }]);
    expect((await waitFor<MatchSetupMessage>(b, 'match.setup', (m) => m.matchId !== oldMatchId)).matchId).toBe(setup.matchId);
    const snapshot = await waitFor<StateSnapshot>(a, 'state.snapshot', (s) => s.matchId === setup.matchId);
    expect(snapshot.players.map((p) => p.id).sort()).toEqual([a.joined.playerId, b.joined.playerId].sort());
    expect(snapshot.players.every((p) => p.health === 150)).toBe(true);

    // Commands for the replaced match are refused; the new match accepts them.
    const still = () => a.socket.emitWithAck('player.input', command(a, { moveX: 0, moveZ: 0, yaw: 0 }));
    expect(await still()).toMatchObject({ ok: false, code: 'wrong_match' });
    a.joined = { ...a.joined, matchId: setup.matchId };
    b.joined = { ...b.joined, matchId: setup.matchId };
    expect(await still()).toEqual({ ok: true });
  });

  it('passes an appearance change to the running match without restarting it', async () => {
    const settings = app.get(SettingsService);
    const appearance = settings.view().sections.appearance;
    const nameTags = !appearance.value.nameTags;
    await settings.updateSection('appearance', { ...appearance.value, nameTags }, appearance.version);

    const update = await waitFor<MatchSetupMessage>(b, 'match.setup', (m) => m.setup.appearance.nameTags === nameTags);
    expect(update.matchId).toBe(b.joined.matchId);
    expect(update.changes).toEqual([{ section: 'appearance', key: 'nameTags', from: !nameTags, to: nameTags }]);
    expect(update.setup.config.startingHealth).toBe(150);
  });

  it('passes a camera change to the running match without restarting it', async () => {
    const settings = app.get(SettingsService);
    const camera = settings.view().sections.camera;
    await settings.updateSection('camera', { ...camera.value, defaultView: 'first-person' }, camera.version);

    const update = await waitFor<MatchSetupMessage>(b, 'match.setup', (m) => m.setup.camera.defaultView === 'first-person');
    expect(update.matchId).toBe(b.joined.matchId);
    expect(update.changes).toEqual([{ section: 'camera', key: 'defaultView', from: 'third-person', to: 'first-person' }]);
  });

  it('every server message on the wire matched the shared contract', () => {
    expect(a.received.length).toBeGreaterThan(10);
    expect(a.invalid).toEqual([]);
    expect(b.invalid).toEqual([]);
  });
});
