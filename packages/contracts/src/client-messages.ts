import { z } from 'zod';
import { clientEnvelope, entityId, finite } from './envelope.js';
import { WeaponIdSchema } from './game-config.js';

export const ClientEvent = {
  RoomJoin: 'room.join',
  PlayerInput: 'player.input',
  ProjectileRequest: 'projectile.request',
  WeaponSelect: 'weapon.select',
  QuestionAnswer: 'question.answer',
} as const;
export type ClientEventName = (typeof ClientEvent)[keyof typeof ClientEvent];

const axis = finite.pipe(z.number().min(-1).max(1));

export const RoomJoinSchema = z.strictObject({
  ...clientEnvelope,
  // No match exists before joining; the server assigns one in the join ack.
  matchId: z.null(),
  roomCode: z.string().regex(/^[A-Z0-9-]{3,16}$/, 'room code must be 3–16 of A–Z, 0–9 or -'),
});

export const PlayerInputSchema = z.strictObject({
  ...clientEnvelope,
  moveX: axis,
  moveZ: axis,
  /** Facing angle in radians (cosmetic; the server never trusts it for movement). */
  yaw: finite,
});

export const ProjectileRequestSchema = z.strictObject({
  ...clientEnvelope,
  /** Throw direction on the ground plane, radians (0 = +Z). */
  yaw: finite,
  /** Up (positive) or down from level, radians. The server limits it to a steep throw either way. */
  pitch: finite,
});

/** Switch to another weapon. Shots fire the weapon held; a new one is ready after the switch time. */
export const WeaponSelectSchema = z.strictObject({
  ...clientEnvelope,
  weapon: WeaponIdSchema,
});

export const QuestionAnswerSchema = z.strictObject({
  ...clientEnvelope,
  encounterId: entityId,
  optionId: entityId,
});

export type RoomJoin = z.infer<typeof RoomJoinSchema>;
export type PlayerInput = z.infer<typeof PlayerInputSchema>;
export type ProjectileRequest = z.infer<typeof ProjectileRequestSchema>;
export type WeaponSelect = z.infer<typeof WeaponSelectSchema>;
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

export const clientMessageSchemas = {
  [ClientEvent.RoomJoin]: RoomJoinSchema,
  [ClientEvent.PlayerInput]: PlayerInputSchema,
  [ClientEvent.ProjectileRequest]: ProjectileRequestSchema,
  [ClientEvent.WeaponSelect]: WeaponSelectSchema,
  [ClientEvent.QuestionAnswer]: QuestionAnswerSchema,
} as const;
