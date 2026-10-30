import type { Rng } from '@volleyland/game-core';

/**
 * The questions each player has been asked in a room, for as long as they stay. It outlives the
 * room's matches: an admin change replaces the match, not the players' sessions, so nobody is asked
 * a question again because the rules or the world changed. A player who leaves and joins again
 * gets a new player ID, so their history starts afresh.
 */
export class QuestionHistory {
  /** Per player: question ID → when it was last asked (a counter, larger is more recent). */
  private readonly asked = new Map<string, Map<string, number>>();
  private asks = 0;

  /**
   * The next question for a player: one they have not been asked yet. Once they have been asked
   * every question in the pool, one from the half they were asked longest ago, so a repeat is as
   * far from its last showing as the pool allows (never the same question twice in a row).
   */
  choose<Q extends { id: string }>(playerId: string, pool: readonly Q[], rng: Rng): Q {
    if (pool.length === 0) throw new Error('Question pool is empty');
    let asked = this.asked.get(playerId);
    if (!asked) {
      asked = new Map();
      this.asked.set(playerId, asked);
    }
    let eligible = pool.filter((q) => !asked.has(q.id));
    if (eligible.length === 0) {
      const oldestFirst = [...pool].sort((a, b) => asked.get(a.id)! - asked.get(b.id)!);
      eligible = oldestFirst.slice(0, Math.ceil(pool.length / 2));
    }
    const question = eligible[Math.floor(rng() * eligible.length)]!;
    asked.set(question.id, ++this.asks);
    return question;
  }

  /** How many different questions a player has been asked. */
  askedCount(playerId: string): number {
    return this.asked.get(playerId)?.size ?? 0;
  }

  /** Drop a player's history (they left; their session is over). */
  forget(playerId: string): void {
    this.asked.delete(playerId);
  }
}
