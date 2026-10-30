import { z } from 'zod';
import { entityId } from './envelope.js';
import { MatchSetupSchema } from './match-setup.js';

export const RejectionCode = z.enum([
  'invalid_payload',
  'protocol_mismatch',
  'wrong_match',
  'stale_sequence',
  'rate_limited',
  'not_in_room',
  'unknown_room',
  'room_full',
  'not_allowed',
]);
export type RejectionCode = z.infer<typeof RejectionCode>;

export const RejectionSchema = z.strictObject({
  ok: z.literal(false),
  code: RejectionCode,
  message: z.string(),
});

export const RoomJoinAcceptedSchema = z.strictObject({
  ok: z.literal(true),
  playerId: entityId,
  matchId: entityId,
  serverTime: z.number().nonnegative(),
  setup: MatchSetupSchema,
});

/** Reply to room.join (a Socket.IO acknowledgement, not a broadcast event). */
export const RoomJoinAckSchema = z.discriminatedUnion('ok', [RoomJoinAcceptedSchema, RejectionSchema]);

/** Reply to any other command when the client asked for an acknowledgement. */
export const CommandAckSchema = z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true) }), RejectionSchema]);

export type Rejection = z.infer<typeof RejectionSchema>;
export type RoomJoinAccepted = z.infer<typeof RoomJoinAcceptedSchema>;
export type RoomJoinAck = z.infer<typeof RoomJoinAckSchema>;
export type CommandAck = z.infer<typeof CommandAckSchema>;
