import { z } from 'zod';
import { GameConfigSchema } from './game-config.js';
import { QuestionPoolSchema } from './question-bank.js';
import { type SettingText, field } from './text.js';
import { WorldIdSchema, WorldSchema } from './world.js';

export type { SettingText } from './text.js';

/**
 * Admin-managed settings, organised into sections. Each section is validated, versioned and
 * stored on its own (one row per section once settings live in a database). The game rules
 * sections together form the flat GameConfig that clients receive on join.
 */
export const SettingsSection = z.enum(['simulation', 'combat', 'movement', 'projectiles', 'weapons', 'rooms', 'questions', 'bots', 'appearance', 'camera']);
export type SettingsSection = z.infer<typeof SettingsSection>;

const game = GameConfigSchema.shape;

/** A setting's words, read back from its field schema. */
export function settingText(section: SettingsSection, key: string): SettingText | null {
  const schema = (SECTION_SCHEMAS[section].shape as Record<string, z.ZodType>)[key];
  const meta = schema?.meta() as Partial<SettingText> | undefined;
  return meta?.title && meta.description ? { title: meta.title, description: meta.description, ...(meta.unit ? { unit: meta.unit } : {}) } : null;
}

export const SimulationSettingsSchema = z
  .strictObject({
    tickRate: game.tickRate.meta(field('Tick rate', 'Simulation steps per second on the server.', '/s')),
    inputStepMs: game.inputStepMs.meta(field('Input step', 'Time covered by one movement input from a client.', 'ms')),
    maxInputCredits: game.maxInputCredits.meta(field('Input buffer', 'Inputs the server holds to absorb network jitter, without letting anyone move faster.', 'inputs')),
  })
  .refine((s) => Math.abs(s.inputStepMs * s.tickRate - 1000) < 1e-6, {
    path: ['inputStepMs'],
    message: 'inputStepMs must be one tick long (1000 / tickRate)',
  });

export const CombatSettingsSchema = z
  .strictObject({
    startingHealth: game.startingHealth.meta(field('Starting health', 'Health at spawn and after every respawn.', 'hp')),
    wrongAnswerDamage: game.wrongAnswerDamage.meta(field('Wrong-answer damage', 'Health lost for a wrong answer or running out of time.', 'hp')),
    answerTimeMs: game.answerTimeMs.meta(field('Answer time', 'Time to answer a question after being hit. Cannot exceed the freeze limit.', 'ms')),
    freezeMaxMs: game.freezeMaxMs.meta(field('Freeze limit', 'The longest a hit player can stay frozen.', 'ms')),
    correctAnswerShieldMs: game.correctAnswerShieldMs.meta(field('Shield after a correct answer', 'How long a player cannot be hit after answering correctly.', 'ms')),
    respawnMs: game.respawnMs.meta(field('Respawn delay', 'Wait before a knocked-out player comes back.', 'ms')),
    spawnProtectionMs: game.spawnProtectionMs.meta(field('Spawn protection', 'How long a player cannot be hit after spawning.', 'ms')),
  })
  .refine((s) => s.answerTimeMs <= s.freezeMaxMs, { path: ['answerTimeMs'], message: 'answerTimeMs cannot exceed freezeMaxMs' });

export const MovementSettingsSchema = z.strictObject({
  playerSpeed: game.playerSpeed.meta(field('Running speed', 'Top speed on the floor.', 'm/s')),
  playerRadius: game.playerRadius.meta(field('Body radius', 'Wider players are easier to hit and bump into cover sooner.', 'm')),
  playerHeight: game.playerHeight.meta(field('Body height', 'Must stay above the projectile flight height.', 'm')),
  maxSlopeDeg: game.maxSlopeDeg.meta(field('Steepest climb', 'Players cannot walk up ground steeper than this (they can walk down it). Only hilly worlds have slopes.', '°')),
});

export const ProjectileSettingsSchema = z.strictObject({
  projectileSpeed: game.projectileSpeed.meta(field('Flight speed', 'Faster throws are harder to dodge.', 'm/s')),
  projectileRadius: game.projectileRadius.meta(field('Size', 'Radius of the projectile; bigger is easier to land.', 'm')),
  projectileLifetimeMs: game.projectileLifetimeMs.meta(field('Flight time', 'How long a throw flies before it vanishes. With speed, this sets the range.', 'ms')),
  projectileCooldownMs: game.projectileCooldownMs.meta(field('Cooldown', 'Minimum gap between two throws by the same player.', 'ms')),
  projectileHeight: game.projectileHeight.meta(field('Throw height', 'Height above the thrower’s feet where a throw leaves the hand; aimed level, it flies at this height. In first person it is also eye height, so throws go exactly where the crosshair points. Must be below body height.', 'm')),
});

/** The blasters players can switch to besides the ball (keys 1–4, Q cycles). Part of the game rules. */
export const WeaponSettingsSchema = z.strictObject({
  weaponSwitchMs: game.weaponSwitchMs.meta(field('Switch time', 'After switching weapon, the new one cannot fire for this long, so switching cannot dodge a reload.', 'ms')),
  blasterEnabled: game.blasterEnabled.meta(field('Blaster', 'A rapid-fire blaster: small, fast bolts at mid range. Off removes it from every player’s choice.')),
  blasterSpeed: game.blasterSpeed.meta(field('Blaster bolt speed', 'Faster bolts are harder to dodge.', 'm/s')),
  blasterRadius: game.blasterRadius.meta(field('Blaster bolt size', 'Radius of a blaster bolt; bigger is easier to land.', 'm')),
  blasterLifetimeMs: game.blasterLifetimeMs.meta(field('Blaster bolt flight time', 'How long a bolt flies before it fades. With speed, this sets the range.', 'ms')),
  blasterCooldownMs: game.blasterCooldownMs.meta(field('Blaster reload', 'Minimum gap between two blaster shots.', 'ms')),
  scatterEnabled: game.scatterEnabled.meta(field('Scatter', 'A spread gun: a fan of bolts at close range. Off removes it from every player’s choice.')),
  scatterSpeed: game.scatterSpeed.meta(field('Scatter bolt speed', 'Speed of each bolt in the fan.', 'm/s')),
  scatterRadius: game.scatterRadius.meta(field('Scatter bolt size', 'Radius of each bolt in the fan.', 'm')),
  scatterLifetimeMs: game.scatterLifetimeMs.meta(field('Scatter flight time', 'How long the fan flies before it fades. With speed, this sets the (short) range.', 'ms')),
  scatterCooldownMs: game.scatterCooldownMs.meta(field('Scatter reload', 'Minimum gap between two scatter shots.', 'ms')),
  scatterPellets: game.scatterPellets.meta(field('Scatter bolts per shot', 'Bolts in each fan. Only the first to reach a player counts: one hit, one question.', 'bolts')),
  scatterSpreadDeg: game.scatterSpreadDeg.meta(field('Scatter spread', 'How wide the fan opens, edge to edge. Wider is easier to land up close and misses more far away.', '°')),
  railEnabled: game.railEnabled.meta(field('Rail', 'A long-range rail sniper: one very fast shot, slow to reload. Off removes it from every player’s choice.')),
  railSpeed: game.railSpeed.meta(field('Rail shot speed', 'Rail shots are meant to be nearly impossible to dodge once fired.', 'm/s')),
  railRadius: game.railRadius.meta(field('Rail shot size', 'Radius of a rail shot; small means the aim has to be good.', 'm')),
  railLifetimeMs: game.railLifetimeMs.meta(field('Rail flight time', 'How long a rail shot flies. With speed, this sets the range.', 'ms')),
  railCooldownMs: game.railCooldownMs.meta(field('Rail reload', 'Minimum gap between two rail shots: the price of its range.', 'ms')),
});

/** Rules for rooms (Phase 0: the one dev room). */
export const RoomRulesSchema = z.strictObject({
  maxPlayers: z
    .int()
    .min(2)
    .max(16)
    .meta(field('Players per room', 'Humans and bots together. Bots give up their seats to joining humans.', 'players')),
  /** The world new matches are played in. */
  worldId: WorldIdSchema.meta(field('World', 'The world new matches are played in (a world ID). Build and edit worlds under Worlds.')),
});

const ms = z.number().nonnegative();
const range = (item: z.ZodNumber) =>
  z.tuple([item, item]).refine(([min, max]) => min <= max, 'range must be [min, max] with min <= max');

/** Server-side bot behaviour (mirrors the server's BotConfig). Never sent to game clients. */
export const BotConfigSchema = z.strictObject({
  fillRoomTo: z.int().min(0).max(16).meta(field('Fill the room to', 'Bots join until the room has this many players. 0 turns bots off.', 'players')),
  moveSpeedFactor: z.number().min(0).max(1).meta(field('Speed', 'Fraction of the human running speed.', '× speed')),
  wanderChangeMs: range(ms).meta(field('Direction changes', 'A bot picks a new direction somewhere in this window ([min, max]).', 'ms')),
  preferredRange: range(z.number().nonnegative()).meta(field('Keeps a distance of', 'Bots close in when farther and back off when nearer ([min, max]).', 'm')),
  aimErrorDeg: z.number().min(0).max(180).meta(field('Aim error', 'Random error added to every normal throw, either side.', '°')),
  reactionMs: ms.meta(field('Reaction time', 'Bots aim at where a player was this long ago, and wait this long after a player can be hit again.', 'ms')),
  leadTarget: z.boolean().meta(field('Aim ahead of moving players', 'Off: running sideways dodges normal throws.')),
  fireIntervalMs: range(ms).meta(field('Time between throws', 'A random gap in this window ([min, max]), never shorter than the throw cooldown.', 'ms')),
  maxRangeFactor: z.number().positive().max(1).meta(field('Throwing range', 'Fraction of the full projectile range bots will throw at.', '× range')),
  missesBeforeSureShot: z
    .int()
    .nonnegative()
    .meta(field('Misses before a sure shot', 'After this many misses in a row the next throw aims ahead with no error. 0 turns sure shots off.', 'misses')),
  sureShotWindupMs: ms.meta(field('Wind-up', 'The bot stands still this long before a sure shot, as a warning.', 'ms')),
  answerCorrectChance: z.number().min(0).max(1).meta(field('Correct answers', 'Chance a bot answers its question correctly.', '0–1')),
  answerDelayMs: range(ms).meta(field('Thinking time', 'How long a bot takes to answer, within this window ([min, max]).', 'ms')),
});

/** How characters look (mirrors game-core's AppearanceSettings). Sent to clients on join. */
export const AppearanceSettingsSchema = z.strictObject({
  palette: z
    .array(z.string().regex(/^#[0-9a-f]{6}$/i, 'use a colour like #56b4e9'))
    .min(4, 'pick at least 4 colours')
    .max(12, 'pick at most 12 colours')
    .meta(field('Player colours', 'Each player gets the next free colour. Keep them distinct from each other and from the floor.')),
  accessories: z.boolean().meta(field('Hats and accessories', 'Players also differ by shape (cap, beanie, crown…), not only by colour.')),
  botMarker: z.boolean().meta(field('Mark bots', 'Bots wear a visor and antenna so everyone can tell them from people.')),
  nameTags: z.boolean().meta(field('Name tags', 'A label over each character: You, Bot 2, Player.')),
  healthBars: z.enum(['off', 'opponents', 'everyone']).meta(field('Health bars', 'Health bars over characters: off, other players only, or everyone. Your own health is always in the corner of the screen.')),
  blobShadows: z.boolean().meta(field('Shadows', 'A soft shadow under each character makes positions easier to judge.')),
  animation: z
    .number()
    .min(0)
    .max(1)
    .meta(field('Animation', 'Run bounce, lean, throw and hit reactions. 0 keeps characters still; players who ask their device to reduce motion always get 0.', '0–1')),
});

/** How the game is seen (mirrors game-core's CameraSettings). Sent to clients on join. */
export const CameraSettingsSchema = z.strictObject({
  defaultView: z
    .enum(['third-person', 'first-person'])
    .meta(field('View', 'Third person: from behind and above, aim with the pointer. First person: through the player’s eyes, aim with the crosshair (the mouse turns).')),
  playerChoice: z.boolean().meta(field('Players can switch view', 'Each player can switch between first and third person with V. Off keeps everyone in the view above.')),
  firstPersonFov: z.number().min(50).max(110).meta(field('First-person field of view', 'How wide the first-person view is. Wider shows more round the edges; narrower feels closer.', '°')),
});

export const SECTION_SCHEMAS = {
  simulation: SimulationSettingsSchema,
  combat: CombatSettingsSchema,
  movement: MovementSettingsSchema,
  projectiles: ProjectileSettingsSchema,
  weapons: WeaponSettingsSchema,
  rooms: RoomRulesSchema,
  questions: QuestionPoolSchema,
  bots: BotConfigSchema,
  appearance: AppearanceSettingsSchema,
  camera: CameraSettingsSchema,
} as const satisfies Record<SettingsSection, z.ZodType>;

/** Each section's name and what it is for, as the admin panel and MCP tool descriptions show it. */
export const SECTION_TEXT: Readonly<Record<SettingsSection, { title: string; summary: string }>> = Object.freeze({
  combat: { title: 'Health and questions', summary: 'What a hit costs, how long players have to answer, and the breathing room after.' },
  movement: { title: 'Movement', summary: 'How fast players run and how big they are to hit.' },
  projectiles: { title: 'Ball', summary: 'Speed, size and reach of the ball (weapon 1), and how often players can throw it.' },
  weapons: {
    title: 'Weapons',
    summary: 'The blasters players switch to besides the ball: a rapid-fire blaster, a close-range scatter and a long-range rail. A hit from any of them freezes the target for a question, like the ball.',
  },
  simulation: { title: 'Simulation', summary: 'The server tick and input budget. Most games never need these changed.' },
  rooms: { title: 'Rooms', summary: 'Who fits in a room and which world they play in.' },
  questions: {
    title: 'Questions asked',
    summary:
      'Which part of the question bank rooms ask from in worlds without their own pool: question banks, classes or years, subjects and difficulty. Only published questions are asked.',
  },
  bots: { title: 'Bots', summary: 'Computer players that fill empty seats. They miss on purpose, so a moving player can always fight back.' },
  appearance: {
    title: 'Characters',
    summary: 'How players look on the court. Looks never change the rules: hits use the same body size whatever the style.',
  },
  camera: {
    title: 'Camera',
    summary: 'How players see the game: from behind and above, or through their own eyes. Both views play by the same rules.',
  },
});

export type SectionValue<S extends SettingsSection> = z.infer<(typeof SECTION_SCHEMAS)[S]>;
export type SectionValues = { [S in SettingsSection]: SectionValue<S> };

/** The game-rule sections, which merge into the flat GameConfig. */
export const GAME_RULE_SECTIONS = ['simulation', 'combat', 'movement', 'projectiles', 'weapons'] as const satisfies readonly SettingsSection[];

/** A stored record with optimistic-concurrency metadata: writes must name the version they replace. */
export const versioned = <T extends z.ZodType>(value: T) =>
  z.strictObject({ value, version: z.int().positive(), updatedAt: z.iso.datetime() });

export type Versioned<T> = { value: T; version: number; updatedAt: string };

const sectionRecords = z.strictObject({
  simulation: versioned(SimulationSettingsSchema),
  combat: versioned(CombatSettingsSchema),
  movement: versioned(MovementSettingsSchema),
  projectiles: versioned(ProjectileSettingsSchema),
  weapons: versioned(WeaponSettingsSchema),
  rooms: versioned(RoomRulesSchema),
  questions: versioned(QuestionPoolSchema),
  bots: versioned(BotConfigSchema),
  appearance: versioned(AppearanceSettingsSchema),
  camera: versioned(CameraSettingsSchema),
});

// ---- Admin HTTP API (/api/admin) ----

export const ADMIN_API_PREFIX = '/api/admin';

export const AdminSettingsResponseSchema = z.strictObject({
  /** The room code players join (deployment setting, not editable here). */
  devRoomCode: z.string(),
  sections: sectionRecords,
  defaults: z.strictObject({
    simulation: SimulationSettingsSchema,
    combat: CombatSettingsSchema,
    movement: MovementSettingsSchema,
    projectiles: ProjectileSettingsSchema,
    weapons: WeaponSettingsSchema,
    rooms: RoomRulesSchema,
    questions: QuestionPoolSchema,
    bots: BotConfigSchema,
    appearance: AppearanceSettingsSchema,
    camera: CameraSettingsSchema,
  }),
  worlds: z.array(versioned(WorldSchema)),
});

export const UpdateSectionRequestSchema = z.strictObject({
  value: z.unknown(),
  expectedVersion: z.int().positive(),
});

/** expectedVersion null creates a new world; otherwise it replaces that version. */
export const SaveWorldRequestSchema = z.strictObject({
  world: z.unknown(),
  expectedVersion: z.int().positive().nullable(),
});

export const AdminErrorSchema = z.strictObject({
  error: z.enum(['invalid', 'conflict', 'not_found', 'unauthorized', 'forbidden', 'unavailable']),
  message: z.string(),
  issues: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
});

export type AdminSettingsResponse = z.infer<typeof AdminSettingsResponseSchema>;
export type UpdateSectionRequest = z.infer<typeof UpdateSectionRequestSchema>;
export type SaveWorldRequest = z.infer<typeof SaveWorldRequestSchema>;
export type AdminError = z.infer<typeof AdminErrorSchema>;
