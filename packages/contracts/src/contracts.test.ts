import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CONTENT_SCHEMAS,
  ContentKind,
  GAME_RULE_SECTIONS,
  QuestionSchema,
  contentFieldText,
  GameConfigSchema,
  MatchSetupMessageSchema,
  PROTOCOL_VERSION,
  WeaponSelectSchema,
  PlayerInputSchema,
  QuestionPresentedSchema,
  QuestionResolvedSchema,
  RoomJoinAckSchema,
  RoomJoinSchema,
  SECTION_SCHEMAS,
  SECTION_TEXT,
  SettingsSection,
  settingText,
  WorldLayoutSchema,
  WorldSchema,
  clientMessageSchemas,
  serverMessageSchemas,
} from './index.js';

const client = (extra: object) => ({ v: PROTOCOL_VERSION, matchId: 'm1', msgId: randomUUID(), seq: 1, ...extra });
const server = (extra: object) => ({ v: PROTOCOL_VERSION, matchId: 'm1', msgId: randomUUID(), serverTime: 1000, tick: 3, ...extra });

const presented = server({
  encounterId: 'e1',
  targetId: 'p2',
  prompt: 'What is 6 × 7?',
  options: [
    { id: 'a', text: '42' },
    { id: 'b', text: '36' },
  ],
  deadline: 11_000,
  answerTimeMs: 10_000,
});

describe('client messages', () => {
  it('needs a pitch on every throw', () => {
    const throwing = clientMessageSchemas['projectile.request'];
    expect(throwing.safeParse(client({ yaw: 1, pitch: -0.2 })).success).toBe(true);
    expect(throwing.safeParse(client({ yaw: 1 })).success).toBe(false);
    expect(throwing.safeParse(client({ yaw: 1, pitch: Number.NaN })).success).toBe(false);
  });

  it('accepts a well-formed player.input', () => {
    expect(PlayerInputSchema.safeParse(client({ moveX: 0.5, moveZ: -1, yaw: 1.2 })).success).toBe(true);
  });

  it('rejects input outside [-1, 1], non-finite values and unknown keys', () => {
    expect(PlayerInputSchema.safeParse(client({ moveX: 2, moveZ: 0, yaw: 0 })).success).toBe(false);
    expect(PlayerInputSchema.safeParse(client({ moveX: Number.NaN, moveZ: 0, yaw: 0 })).success).toBe(false);
    expect(PlayerInputSchema.safeParse(client({ moveX: 0, moveZ: 0, yaw: 0, x: 99 })).success).toBe(false);
  });

  it('requires the full envelope on every command', () => {
    for (const field of ['v', 'matchId', 'msgId', 'seq']) {
      const message: Record<string, unknown> = client({ moveX: 0, moveZ: 0, yaw: 0 });
      delete message[field];
      expect(PlayerInputSchema.safeParse(message).success, field).toBe(false);
    }
    expect(PlayerInputSchema.safeParse({ ...client({ moveX: 0, moveZ: 0, yaw: 0 }), v: PROTOCOL_VERSION + 1 }).success).toBe(false);
  });

  it('room.join carries a null match ID and a well-formed room code', () => {
    expect(RoomJoinSchema.safeParse(client({ matchId: null, roomCode: 'DEV-1' })).success).toBe(true);
    expect(RoomJoinSchema.safeParse(client({ matchId: null, roomCode: 'dev; drop' })).success).toBe(false);
  });

  it('defines every client event', () => {
    expect(Object.keys(clientMessageSchemas).sort()).toEqual(
      ['player.input', 'projectile.request', 'question.answer', 'room.join', 'weapon.select'].sort(),
    );
  });

  it('weapon.select names a known weapon', () => {
    expect(WeaponSelectSchema.safeParse(client({ weapon: 'rail' })).success).toBe(true);
    expect(WeaponSelectSchema.safeParse(client({ weapon: 'bazooka' })).success).toBe(false);
  });
});

describe('server messages', () => {
  it('defines every server event', () => {
    expect(Object.keys(serverMessageSchemas).sort()).toEqual(
      [
        'bot.windup',
        'health.changed',
        'hit.confirmed',
        'match.setup',
        'player.respawned',
        'projectile.spawned',
        'question.presented',
        'question.resolved',
        'state.snapshot',
      ].sort(),
    );
  });

  it('question.presented can never carry an answer key', () => {
    expect(QuestionPresentedSchema.safeParse(presented).success).toBe(true);
    for (const leak of [{ correctOptionId: 'a' }, { answer: 'a' }]) {
      expect(QuestionPresentedSchema.safeParse({ ...presented, ...leak }).success).toBe(false);
    }
    const optionLeak = { ...presented, options: [{ id: 'a', text: '42', correct: true }, { id: 'b', text: '36' }] };
    expect(QuestionPresentedSchema.safeParse(optionLeak).success).toBe(false);
  });

  it('question.resolved reports the server outcome', () => {
    const resolved = server({
      encounterId: 'e1',
      targetId: 'p2',
      outcome: 'timeout',
      selectedOptionId: null,
      correctOptionId: null,
      explanation: null,
    });
    expect(QuestionResolvedSchema.safeParse(resolved).success).toBe(true);
  });
});

describe('acks', () => {
  it('room.join ack is either accepted with config or a typed rejection', () => {
    expect(RoomJoinAckSchema.safeParse({ ok: false, code: 'room_full', message: 'Room is full' }).success).toBe(true);
    expect(RoomJoinAckSchema.safeParse({ ok: false, code: 'nope', message: '' }).success).toBe(false);
  });
});

const gameConfig = {
  tickRate: 20, inputStepMs: 50, maxInputCredits: 4, startingHealth: 100, wrongAnswerDamage: 25, answerTimeMs: 10000, freezeMaxMs: 10000,
  correctAnswerShieldMs: 2000, respawnMs: 4000, spawnProtectionMs: 2000, playerSpeed: 6, playerRadius: 0.5, playerHeight: 1.8, maxSlopeDeg: 40,
  projectileSpeed: 18, projectileRadius: 0.25, projectileLifetimeMs: 1500, projectileCooldownMs: 500, projectileHeight: 1.2,
  weaponSwitchMs: 250, blasterEnabled: true, blasterSpeed: 32, blasterRadius: 0.12, blasterLifetimeMs: 650, blasterCooldownMs: 220,
  scatterEnabled: true, scatterSpeed: 24, scatterRadius: 0.14, scatterLifetimeMs: 450, scatterCooldownMs: 900, scatterPellets: 5, scatterSpreadDeg: 24,
  railEnabled: true, railSpeed: 70, railRadius: 0.1, railLifetimeMs: 700, railCooldownMs: 2200,
};

const camera = { defaultView: 'third-person', playerChoice: true, firstPersonFov: 75 };

const appearance = {
  palette: ['#56b4e9', '#e69f00', '#2ec4a0', '#f0e442'], accessories: true, botMarker: true, nameTags: true, healthBars: 'opponents', blobShadows: true, animation: 1,
};

describe('appearance', () => {
  it('accepts 4–12 hex colours and the known options only', () => {
    expect(SECTION_SCHEMAS.appearance.safeParse(appearance).success).toBe(true);
    expect(SECTION_SCHEMAS.appearance.safeParse({ ...appearance, palette: ['#56b4e9', '#e69f00', '#2ec4a0'] }).success).toBe(false);
    expect(SECTION_SCHEMAS.appearance.safeParse({ ...appearance, palette: [...appearance.palette.slice(0, 3), 'red'] }).success).toBe(false);
    expect(SECTION_SCHEMAS.appearance.safeParse({ ...appearance, healthBars: 'sometimes' }).success).toBe(false);
    expect(SECTION_SCHEMAS.appearance.safeParse({ ...appearance, animation: 2 }).success).toBe(false);
  });
});

describe('worlds', () => {
  const layout = {
    halfWidth: 10,
    halfDepth: 10,
    theme: 'park',
    floor: 'grass',
    scatter: 0.5,
    regions: [{ surface: 'cobbles', shape: 'rect', x: 0, z: 0, width: 20, depth: 3, rotation: 0 }],
    props: [{ kind: 'block', x: 0, z: 0, width: 2, depth: 2, height: 1.5, rotation: 0 }],
    spawnPoints: [
      { x: -5, z: 0 },
      { x: 5, z: 0 },
    ],
  };
  const world = { id: 'yard', name: 'Yard', description: '', layout };

  it('accepts a world whose props and spawns sit on the floor', () => {
    expect(WorldSchema.safeParse(world).success).toBe(true);
  });

  it('rejects bad IDs, props past the edge, spawns off the floor or inside props, and too few spawns', () => {
    expect(WorldSchema.safeParse({ ...world, id: 'Bad ID' }).success).toBe(false);
    const messages = (l: object) => WorldLayoutSchema.safeParse(l).error?.issues.map((i) => i.message) ?? [];
    const block = layout.props[0]!;
    expect(messages({ ...layout, props: [{ ...block, x: 9.5 }] })).toEqual(['Prop 1 (block) extends past the floor edge']);
    expect(messages({ ...layout, spawnPoints: [{ x: 0, z: 0.5 }, { x: 11, z: 0 }] })).toEqual(['Spawn point 1 is inside prop 1', 'Spawn point 2 is off the floor']);
    expect(WorldLayoutSchema.safeParse({ ...layout, spawnPoints: [{ x: 5, z: 5 }] }).success).toBe(false);
  });

  it('measures turned boxes and round props by their real footprint', () => {
    const messages = (l: object) => WorldLayoutSchema.safeParse(l).error?.issues.map((i) => i.message) ?? [];
    // An 8 m wall along x fits at x = 7 only once turned to run along z.
    const wall = { kind: 'wall', x: 7, z: 0, width: 8, depth: 0.6, height: 2, rotation: 0 };
    expect(messages({ ...layout, props: [wall], spawnPoints: [{ x: -5, z: 0 }, { x: 2, z: 0 }] })).toEqual(['Prop 1 (wall) extends past the floor edge']);
    expect(messages({ ...layout, props: [{ ...wall, rotation: 90 }], spawnPoints: [{ x: -5, z: 0 }, { x: 2, z: 0 }] })).toEqual([]);
    // A spawn in the corner of a rock's bounding box is outside the rock itself.
    const rock = { kind: 'rock', x: 0, z: 0, width: 4, depth: 4, height: 1, rotation: 0 };
    expect(messages({ ...layout, props: [rock], spawnPoints: [{ x: 1.8, z: 1.8 }, { x: 5, z: 0 }] })).toEqual([]);
    expect(messages({ ...layout, props: [{ ...rock, depth: 3 }] })).toEqual(['a round prop is as deep as it is wide']);
  });

  it('accepts terrain and hills, and rejects hills off the floor or out of range', () => {
    const terrain = { relief: 3, scale: 24, seed: 4, symmetry: 'quad' };
    const hill = { x: 2, z: -3, width: 12, depth: 8, rotation: 30, height: -2, plateau: 0.3 };
    expect(WorldLayoutSchema.safeParse({ ...layout, terrain, hills: [hill] }).success).toBe(true);
    expect(WorldLayoutSchema.safeParse({ ...layout, terrain: { ...terrain, symmetry: 'spiral' } }).success).toBe(false);
    expect(WorldLayoutSchema.safeParse({ ...layout, terrain: { ...terrain, relief: 40 } }).success).toBe(false);
    expect(WorldLayoutSchema.safeParse({ ...layout, hills: [{ ...hill, plateau: 1 }] }).success).toBe(false);
    const messages = (l: object) => WorldLayoutSchema.safeParse(l).error?.issues.map((i) => i.message) ?? [];
    expect(messages({ ...layout, hills: [{ ...hill, x: 12 }] })).toEqual(['Hill 1 is centred off the floor']);
  });

  it('rejects unknown themes, surfaces and prop kinds', () => {
    expect(WorldLayoutSchema.safeParse({ ...layout, theme: 'volcano' }).success).toBe(false);
    expect(WorldLayoutSchema.safeParse({ ...layout, floor: 'lava' }).success).toBe(false);
    expect(WorldLayoutSchema.safeParse({ ...layout, props: [{ ...layout.props[0]!, kind: 'dragon' }] }).success).toBe(false);
  });

  it('room.join acceptance carries the world layout', () => {
    const setup = { config: gameConfig, world: { id: 'yard', name: 'Yard', layout }, appearance, camera };
    expect(RoomJoinAckSchema.safeParse({ ok: true, playerId: 'p1', matchId: 'm1', serverTime: 1, setup }).success).toBe(true);
    const { world: _world, ...withoutWorld } = setup;
    expect(RoomJoinAckSchema.safeParse({ ok: true, playerId: 'p1', matchId: 'm1', serverTime: 1, setup: withoutWorld }).success).toBe(false);
  });

  it('match.setup carries the same setup as the join ack, and nothing else', () => {
    const setup = { config: gameConfig, world: { id: 'yard', name: 'Yard', layout }, appearance, camera };
    const changes = [
      { section: 'movement', key: 'playerSpeed', from: 6, to: 8 },
      { section: 'bots', key: 'aimErrorDeg', from: null, to: null },
    ];
    expect(MatchSetupMessageSchema.safeParse(server({ setup, changes })).success).toBe(true);
    expect(MatchSetupMessageSchema.safeParse(server({ setup: { ...setup, bots: {} }, changes })).success).toBe(false);
    expect(MatchSetupMessageSchema.safeParse(server({ setup, changes: [] })).success).toBe(false);
    expect(MatchSetupMessageSchema.safeParse(server({ setup, changes: [{ section: 'bots', key: 'preferredRange', from: [4, 9], to: null }] })).success).toBe(false);
  });
});

describe('settings sections', () => {
  it('splits the game config into sections that cover every rule exactly once', () => {
    const keys = GAME_RULE_SECTIONS.flatMap((s) => Object.keys(SECTION_SCHEMAS[s].shape)).sort();
    expect(keys).toEqual(Object.keys(GameConfigSchema.shape).sort());
  });

  it('rejects an input step that is not one tick long', () => {
    expect(SECTION_SCHEMAS.simulation.safeParse({ tickRate: 20, inputStepMs: 50, maxInputCredits: 4 }).success).toBe(true);
    expect(SECTION_SCHEMAS.simulation.safeParse({ tickRate: 30, inputStepMs: 50, maxInputCredits: 4 }).success).toBe(false);
  });

  it('describes every setting, and JSON Schema carries the words', () => {
    for (const section of SettingsSection.options) {
      expect(SECTION_TEXT[section].title, section).not.toBe('');
      for (const key of Object.keys(SECTION_SCHEMAS[section].shape)) {
        expect(settingText(section, key), `${section}.${key}`).toMatchObject({ title: expect.any(String), description: expect.any(String) });
      }
    }
    const schema = z.toJSONSchema(SECTION_SCHEMAS.combat) as { properties: Record<string, Record<string, unknown>> };
    expect(schema.properties.answerTimeMs).toMatchObject({ title: 'Answer time', unit: 'ms', description: expect.stringContaining('freeze limit') });
    // The game config the clients get is untouched by the admin text.
    expect(GameConfigSchema.shape.answerTimeMs.meta()).toBeUndefined();
  });
});

describe('question bank schemas', () => {
  const question = {
    id: 'q-1',
    topicId: 'topic',
    difficulty: 2,
    status: 'published',
    prompt: 'Two plus two?',
    options: [
      { id: 'a', text: '3' },
      { id: 'b', text: '4' },
    ],
    source: { sourceId: 'book', use: 'aligned', reference: 'Chapter 1' },
  };

  it('never carry an answer key: it is server-only', () => {
    expect(QuestionSchema.safeParse(question).success).toBe(true);
    for (const leak of [{ correctOptionId: 'b' }, { explanation: 'Because.' }]) {
      expect(QuestionSchema.safeParse({ ...question, ...leak }).success).toBe(false);
    }
    const json = JSON.stringify(ContentKind.options.map((kind) => z.toJSONSchema(CONTENT_SCHEMAS[kind])));
    expect(json).not.toMatch(/correctOptionId|"explanation"/);
  });

  it('give every field its words, for the CMS forms and MCP tools', () => {
    for (const kind of ContentKind.options) {
      const keys = Object.keys((CONTENT_SCHEMAS[kind] as unknown as { shape: object }).shape ?? {});
      for (const key of keys.filter((k) => k !== 'source')) expect(contentFieldText(kind, key), `${kind}.${key}`).not.toBeNull();
    }
    for (const key of ['source.sourceId', 'source.use', 'source.reference']) expect(contentFieldText('questions', key), key).not.toBeNull();
  });
});
