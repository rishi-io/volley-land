import { z } from 'zod';
import { entityId, finite, serverEnvelope } from './envelope.js';
import { WeaponIdSchema } from './game-config.js';
import { MatchSetupSchema, SettingChangeSchema } from './match-setup.js';

export const ServerEvent = {
  StateSnapshot: 'state.snapshot',
  ProjectileSpawned: 'projectile.spawned',
  HitConfirmed: 'hit.confirmed',
  QuestionPresented: 'question.presented',
  QuestionResolved: 'question.resolved',
  HealthChanged: 'health.changed',
  PlayerRespawned: 'player.respawned',
  MatchSetup: 'match.setup',
  BotWindup: 'bot.windup',
} as const;
export type ServerEventName = (typeof ServerEvent)[keyof typeof ServerEvent];

export const PlayerStatus = z.enum(['alive', 'frozen', 'dead']);
export type PlayerStatus = z.infer<typeof PlayerStatus>;

/** Players stand on the ground: clients read their height off the world's terrain, so it is not sent. */
export const PlayerSnapshotSchema = z.strictObject({
  id: entityId,
  x: finite,
  z: finite,
  yaw: finite,
  health: z.int().nonnegative(),
  status: PlayerStatus,
  /** Cannot be hit (encounter, correct-answer shield or spawn protection). */
  protected: z.boolean(),
  /** Highest player.input sequence the server has applied for this player (for reconciliation). */
  lastInputSeq: z.int().min(-1),
  /** A computer player. */
  bot: z.boolean(),
  /** Appearance slot, unique among the players in the room while they stay (picks colour and accessory). */
  look: z.int().nonnegative(),
  /** The weapon in hand. */
  weapon: WeaponIdSchema,
});

export const ProjectileSnapshotSchema = z.strictObject({
  id: entityId,
  x: finite,
  /** Height above the flat floor level (throws fly up and down hills). */
  y: finite,
  z: finite,
  /** What fired it (how it is drawn). */
  weapon: WeaponIdSchema,
});

export const StateSnapshotSchema = z.strictObject({
  ...serverEnvelope,
  players: z.array(PlayerSnapshotSchema),
  projectiles: z.array(ProjectileSnapshotSchema),
});

export const ProjectileSpawnedSchema = z.strictObject({
  ...serverEnvelope,
  projectileId: entityId,
  ownerId: entityId,
  weapon: WeaponIdSchema,
  x: finite,
  y: finite,
  z: finite,
  vx: finite,
  vy: finite,
  vz: finite,
});

export const HitConfirmedSchema = z.strictObject({
  ...serverEnvelope,
  projectileId: entityId,
  shooterId: entityId,
  targetId: entityId,
  encounterId: entityId,
});

export const QuestionOptionSchema = z.strictObject({
  id: entityId,
  text: z.string().min(1).max(500),
});

/** Sent only to the hit player. Strict: an answer key can never ride along. */
export const QuestionPresentedSchema = z.strictObject({
  ...serverEnvelope,
  encounterId: entityId,
  targetId: entityId,
  prompt: z.string().min(1).max(2000),
  options: z.array(QuestionOptionSchema).min(2).max(6),
  /** Server-clock deadline (ms); the server alone decides whether an answer was in time. */
  deadline: z.number().nonnegative(),
  answerTimeMs: z.int().positive(),
});

export const EncounterOutcome = z.enum(['correct', 'incorrect', 'timeout']);
export type EncounterOutcome = z.infer<typeof EncounterOutcome>;

export const QuestionResolvedSchema = z.strictObject({
  ...serverEnvelope,
  encounterId: entityId,
  targetId: entityId,
  outcome: EncounterOutcome,
  selectedOptionId: entityId.nullable(),
  /** Revealed only to the answering player, and only after the encounter is resolved. */
  correctOptionId: entityId.nullable(),
  explanation: z.string().max(2000).nullable(),
});

export const HealthChangedSchema = z.strictObject({
  ...serverEnvelope,
  playerId: entityId,
  health: z.int().nonnegative(),
  delta: z.int(),
  reason: z.enum(['incorrect', 'timeout', 'respawn']),
});

export const PlayerRespawnedSchema = z.strictObject({
  ...serverEnvelope,
  playerId: entityId,
  x: finite,
  z: finite,
  health: z.int().positive(),
  protectedUntil: z.number().nonnegative(),
});

/**
 * A bot stopped to line up a sure shot at a player. Presentation only (the client plays the bot's
 * warning line); the throw itself is decided and reported like any other.
 */
export const BotWindupSchema = z.strictObject({
  ...serverEnvelope,
  playerId: entityId,
  targetId: entityId,
});

/**
 * An admin change reached the room. A new envelope matchId means the match was replaced: every
 * player respawns under the new rules and world, and commands must carry the new matchId. The same
 * matchId means only the presentation (appearance) changed. `changes` says what changed, so
 * clients can tell players instead of changing the game under them.
 */
export const MatchSetupMessageSchema = z.strictObject({
  ...serverEnvelope,
  setup: MatchSetupSchema,
  changes: z.array(SettingChangeSchema).min(1).max(100),
});

export type PlayerSnapshot = z.infer<typeof PlayerSnapshotSchema>;
export type ProjectileSnapshot = z.infer<typeof ProjectileSnapshotSchema>;
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;
export type ProjectileSpawned = z.infer<typeof ProjectileSpawnedSchema>;
export type HitConfirmed = z.infer<typeof HitConfirmedSchema>;
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type QuestionPresented = z.infer<typeof QuestionPresentedSchema>;
export type QuestionResolved = z.infer<typeof QuestionResolvedSchema>;
export type HealthChanged = z.infer<typeof HealthChangedSchema>;
export type PlayerRespawned = z.infer<typeof PlayerRespawnedSchema>;
export type MatchSetupMessage = z.infer<typeof MatchSetupMessageSchema>;
export type BotWindup = z.infer<typeof BotWindupSchema>;

export const serverMessageSchemas = {
  [ServerEvent.StateSnapshot]: StateSnapshotSchema,
  [ServerEvent.ProjectileSpawned]: ProjectileSpawnedSchema,
  [ServerEvent.HitConfirmed]: HitConfirmedSchema,
  [ServerEvent.QuestionPresented]: QuestionPresentedSchema,
  [ServerEvent.QuestionResolved]: QuestionResolvedSchema,
  [ServerEvent.HealthChanged]: HealthChangedSchema,
  [ServerEvent.PlayerRespawned]: PlayerRespawnedSchema,
  [ServerEvent.MatchSetup]: MatchSetupMessageSchema,
  [ServerEvent.BotWindup]: BotWindupSchema,
} as const;
