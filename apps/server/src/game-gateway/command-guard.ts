import {
  ClientEvent,
  type ClientEventName,
  PROTOCOL_VERSION,
  type Rejection,
  type RejectionCode,
  clientMessageSchemas,
} from '@volleyland/contracts';
import type { z } from 'zod';
import { TokenBucket } from './token-bucket.js';

type Parsed<E extends ClientEventName> = z.infer<(typeof clientMessageSchemas)[E]>;
export type GuardResult<E extends ClientEventName> = { ok: true; message: Parsed<E> } | Rejection;

/** Burst capacity and sustained rate per event. Clients send player.input at 20/s; the blaster fires about 4–5 shots a second. */
export const RATE_LIMITS: Record<ClientEventName, { capacity: number; perSecond: number }> = {
  [ClientEvent.RoomJoin]: { capacity: 3, perSecond: 0.2 },
  [ClientEvent.PlayerInput]: { capacity: 10, perSecond: 25 },
  [ClientEvent.ProjectileRequest]: { capacity: 4, perSecond: 8 },
  [ClientEvent.WeaponSelect]: { capacity: 4, perSecond: 4 },
  [ClientEvent.QuestionAnswer]: { capacity: 3, perSecond: 2 },
};

const rejection = (code: RejectionCode, message: string): Rejection => ({ ok: false, code, message });

/**
 * Per-connection admission control for client commands, cheapest check first:
 * rate limit → protocol version → schema → match → sequence.
 */
export class CommandGuard {
  private lastSeq = -1;
  private readonly buckets: Record<ClientEventName, TokenBucket>;

  constructor(now: number) {
    this.buckets = Object.fromEntries(
      Object.entries(RATE_LIMITS).map(([event, limit]) => [event, new TokenBucket(limit.capacity, limit.perSecond, now)]),
    ) as Record<ClientEventName, TokenBucket>;
  }

  /**
   * `matchId` is the match the connection is in right now (null before it joins). It is passed in
   * rather than remembered because an admin change can replace the room's match at any time.
   */
  admit<E extends ClientEventName>(event: E, raw: unknown, now: number, matchId: string | null): GuardResult<E> {
    if (!this.buckets[event].tryTake(now)) return rejection('rate_limited', `Too many ${event} messages`);

    const version = typeof raw === 'object' && raw !== null ? (raw as { v?: unknown }).v : undefined;
    if (version !== PROTOCOL_VERSION) return rejection('protocol_mismatch', `Expected protocol version ${PROTOCOL_VERSION}`);

    const parsed = clientMessageSchemas[event].safeParse(raw);
    if (!parsed.success) return rejection('invalid_payload', parsed.error.issues[0]?.message ?? 'Invalid payload');
    const message = parsed.data as Parsed<E>;

    if (event === ClientEvent.RoomJoin) {
      if (matchId !== null) return rejection('not_allowed', 'Already in a room');
    } else {
      if (matchId === null) return rejection('not_in_room', 'Join a room first');
      if (message.matchId !== matchId) return rejection('wrong_match', 'Message is for a different match');
    }

    if (message.seq <= this.lastSeq) return rejection('stale_sequence', `Sequence ${message.seq} is not after ${this.lastSeq}`);
    this.lastSeq = message.seq;
    return { ok: true, message };
  }
}
