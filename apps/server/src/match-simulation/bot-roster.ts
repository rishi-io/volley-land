import type { Arena, GameConfig } from '@volleyland/game-core';
import type { BotConfig } from '../config/bot-config.js';
import { Bot } from './bot.js';
import type { Match, MatchEventSink } from './match.js';

/**
 * The bots in one room. It sits between the match and the transport: room events go to both
 * clients and bots, and events addressed to a bot go only to that bot.
 */
export class BotRoster {
  private readonly bots = new Map<string, Bot>();
  private match: Match | null = null;
  private counter = 0;

  constructor(
    private readonly config: BotConfig,
    private readonly game: GameConfig,
    private readonly arena: Arena,
    private readonly now: () => number,
  ) {}

  get count(): number {
    return this.bots.size;
  }

  get ids(): string[] {
    return [...this.bots.keys()];
  }

  has(playerId: string): boolean {
    return this.bots.has(playerId);
  }

  /** The match's sink: forwards to the transport and lets bots observe what a client would. */
  wrap(transport: MatchEventSink): MatchEventSink {
    return {
      toRoom: (event, payload) => {
        transport.toRoom(event, payload);
        for (const bot of this.bots.values()) bot.observe(event, payload);
      },
      toPlayer: (playerId, event, payload) => {
        const bot = this.bots.get(playerId);
        if (bot) bot.observe(event, payload);
        else transport.toPlayer(playerId, event, payload);
      },
    };
  }

  attach(match: Match): void {
    this.match = match;
  }

  /** Add or remove bots so humans plus bots reach `fillRoomTo`, never taking a seat beyond `maxPlayers`. */
  balance(humans: number, maxPlayers: number): void {
    const wanted = humans === 0 ? 0 : Math.max(0, Math.min(this.config.fillRoomTo - humans, maxPlayers - humans));
    while (this.bots.size < wanted) this.add();
    while (this.bots.size > wanted) this.removeNewest();
  }

  /** Remove the most recently added bot, freeing its seat. Returns its ID, or null when there are no bots. */
  removeNewest(): string | null {
    const id = [...this.bots.keys()].at(-1);
    if (id === undefined) return null;
    this.bots.delete(id);
    this.requireMatch().removePlayer(id);
    return id;
  }

  /** Let every bot issue its commands for this tick (before the match steps). */
  act(): void {
    for (const bot of this.bots.values()) bot.act();
  }

  private add(): string {
    const match = this.requireMatch();
    const id = `bot-${++this.counter}`;
    // Register first so the bot sees the snapshot that follows its spawn.
    this.bots.set(id, new Bot(id, match, this.config, this.game, this.arena, this.now));
    match.addPlayer(id, { bot: true });
    return id;
  }

  private requireMatch(): Match {
    if (!this.match) throw new Error('BotRoster is not attached to a match');
    return this.match;
  }
}
