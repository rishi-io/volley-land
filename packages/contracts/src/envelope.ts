import { z } from 'zod';

/** Bump on any breaking change to a socket message shape. */
export const PROTOCOL_VERSION = 9 as const;

const id = z.string().min(1).max(64);

/** Every client command: protocol version, match, unique message ID and a per-connection sequence. */
export const clientEnvelope = {
  v: z.literal(PROTOCOL_VERSION),
  matchId: id,
  msgId: z.uuid(),
  seq: z.int().nonnegative(),
};

/** Every server event: protocol version, match, unique message ID, server clock and tick. */
export const serverEnvelope = {
  v: z.literal(PROTOCOL_VERSION),
  matchId: id,
  msgId: z.uuid(),
  serverTime: z.number().nonnegative(),
  tick: z.int().nonnegative(),
};

export const entityId = id;
export const finite = z.number().refine(Number.isFinite, 'must be finite');
