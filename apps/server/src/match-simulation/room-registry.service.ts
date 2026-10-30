import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { MatchSetup, RejectionCode } from '@volleyland/contracts';
import { arenaFromLayout, tickIntervalMs } from '@volleyland/game-core';
import { QuestionHistory } from '../question-selection/question-history.js';
import { QuestionSelectionService } from '../question-selection/question-selection.service.js';
import { type LiveSettings, SettingsService, questionPoolOf } from '../settings/settings.service.js';
import { BotRoster } from './bot-roster.js';
import { Match, type MatchEventSink } from './match.js';
import { settingsChange } from './settings-change.js';

export type JoinResult = { ok: true; playerId: string; matchId: string; setup: MatchSetup } | { ok: false; code: RejectionCode; message: string };

/** Builds the event sink for a room; supplied by the transport (the game gateway). */
export type SinkFactory = (roomCode: string) => MatchEventSink;

interface Room {
  code: string;
  /** The settings the current match runs with. A rules change replaces the match, never mutates it. */
  settings: LiveSettings;
  match: Match;
  bots: BotRoster;
  /** What each player has been asked here; kept across the room's matches, dropped when they leave. */
  questions: QuestionHistory;
  timer: NodeJS.Timeout;
  /** Fixed-timestep bookkeeping: real time not yet simulated, and when it was last measured. */
  pendingMs: number;
  lastLoopAt: number;
}

/** An open room as an admin sees it: no players' answers, questions or positions. */
export interface RoomSummary {
  code: string;
  matchId: string;
  worldId: string;
  tick: number;
  humans: number;
  bots: number;
  maxPlayers: number;
}

/** What clients are sent about a match: its rules, world layout, appearance and camera. */
export function matchSetupOf(settings: LiveSettings): MatchSetup {
  const { id, name, layout } = settings.world;
  return { config: settings.game, world: { id, name, layout }, appearance: settings.appearance, camera: settings.camera };
}

const STATS_INTERVAL_MS = 30_000;
/** Cap on catch-up steps per wake-up, so a long stall cannot spiral into a burst of ticks. */
const MAX_CATCH_UP_STEPS = 3;

/**
 * Rooms and their authoritative tick loops. Phase 0: one dev room, no accounts. Bots fill empty
 * seats (BotConfig.fillRoomTo) and give them up when humans join.
 *
 * Admin changes reach open rooms as soon as they are saved: a rules change starts a new match in
 * each room with the same humans, an appearance or camera change is passed on to the running match. Either
 * way the room's clients get a match.setup event.
 */
@Injectable()
export class RoomRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomRegistry.name);
  private readonly rooms = new Map<string, Room>();
  private sinkFactory: SinkFactory | null = null;
  private readonly loopDelay: ReturnType<typeof monitorEventLoopDelay> = monitorEventLoopDelay({ resolution: 10 });
  private readonly tickDurations: number[] = [];
  private statsTimer: NodeJS.Timeout | null = null;
  private stopWatchingSettings: (() => void) | null = null;
  /** Clock for all matches; injectable so tests can drive time. */
  now: () => number = () => Date.now();

  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(QuestionSelectionService) private readonly questionSelection: QuestionSelectionService,
  ) {}

  onModuleInit(): void {
    this.stopWatchingSettings = this.settings.onChange((live) => this.applySettings(live));
  }

  useSinkFactory(factory: SinkFactory): void {
    this.sinkFactory = factory;
  }

  join(roomCode: string, playerId: string): JoinResult {
    if (roomCode !== this.settings.devRoomCode) return { ok: false, code: 'unknown_room', message: 'No such room' };
    const room = this.rooms.get(roomCode) ?? this.openRoom(roomCode);
    const { maxPlayers } = room.settings.rooms;
    if (this.humansIn(room) >= maxPlayers) return { ok: false, code: 'room_full', message: 'Room is full' };
    if (room.match.playerCount >= maxPlayers) {
      const bot = room.bots.removeNewest(); // a human always gets a bot's seat
      this.logger.log(`Bot ${bot} left ${roomCode} to make room`);
    }
    room.match.addPlayer(playerId);
    this.logger.log(`Player ${playerId} joined ${roomCode} (${room.match.playerCount}/${maxPlayers})`);
    this.balanceBots(room);
    return { ok: true, playerId, matchId: room.match.id, setup: matchSetupOf(room.settings) };
  }

  matchFor(roomCode: string): Match | null {
    return this.rooms.get(roomCode)?.match ?? null;
  }

  leave(roomCode: string, playerId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    room.match.removePlayer(playerId);
    room.questions.forget(playerId);
    this.logger.log(`Player ${playerId} left ${roomCode}`);
    if (this.humansIn(room) === 0) this.closeRoom(room);
    else this.balanceBots(room);
  }

  /** Every open room, for admins. */
  describeRooms(): RoomSummary[] {
    return [...this.rooms.values()].map((room) => ({
      code: room.code,
      matchId: room.match.id,
      worldId: room.settings.world.id,
      tick: room.match.tick,
      humans: this.humansIn(room),
      bots: room.bots.count,
      maxPlayers: room.settings.rooms.maxPlayers,
    }));
  }

  /** IDs of the bots currently in a room. */
  botsIn(roomCode: string): string[] {
    return this.rooms.get(roomCode)?.bots.ids ?? [];
  }

  /** Advance every room one tick (the interval does this in production; tests call it directly). */
  stepAll(): void {
    for (const room of this.rooms.values()) this.stepRoom(room);
  }

  /** Bring every open room up to date with saved settings (called on every admin change). */
  applySettings(live: LiveSettings): void {
    for (const room of [...this.rooms.values()]) {
      const { kind, changes } = settingsChange(room.settings, live);
      if (kind === 'none') continue;
      const summary = changes.map((c) => `${c.section}.${c.key}`).join(', ');
      if (kind === 'rules') {
        const next = this.restartMatch(room, live);
        next.match.announceSetup(matchSetupOf(live), changes);
        this.logger.log(`Room ${room.code}: started match ${next.match.id} after changes to ${summary}`);
      } else {
        room.settings = { ...room.settings, appearance: live.appearance, camera: live.camera };
        room.match.announceSetup(matchSetupOf(room.settings), changes);
        this.logger.log(`Room ${room.code}: presentation updated (${summary})`);
      }
    }
  }

  onModuleDestroy(): void {
    this.stopWatchingSettings?.();
    for (const room of this.rooms.values()) this.closeRoom(room);
  }

  private openRoom(code: string): Room {
    const room = this.startMatch(code, this.settings.live(), [], new QuestionHistory());
    this.startStats();
    this.logger.log(`Opened room ${code} with match ${room.match.id} in world ${room.settings.world.id} at ${room.settings.game.tickRate} ticks/s`);
    return room;
  }

  /**
   * Replace a room's match with a new one under new settings. Its humans stay, respawned; bots are
   * re-seated. The question history stays too: players' sessions go on.
   */
  private restartMatch(old: Room, settings: LiveSettings): Room {
    clearInterval(old.timer);
    return this.startMatch(old.code, settings, old.match.humanIds, old.questions);
  }

  /**
   * Build a match with its bots and tick loop, seat the given humans (all of them, even if
   * maxPlayers is now lower) and register it as the room's current match.
   */
  private startMatch(code: string, settings: LiveSettings, humans: string[], questions: QuestionHistory): Room {
    if (!this.sinkFactory) throw new Error('RoomRegistry has no event sink; the game gateway must register one');
    const matchId = randomUUID();
    const arena = arenaFromLayout(settings.world.layout);
    const now = () => this.now();
    const bots = new BotRoster(settings.bots, settings.game, arena, now);
    const match = new Match(matchId, settings.game, arena, this.questionSelection.forMatch(matchId, questionPoolOf(settings), questions), bots.wrap(this.sinkFactory(code)), now);
    bots.attach(match);
    for (const playerId of humans) match.addPlayer(playerId);
    const tickMs = tickIntervalMs(settings.game);
    // setInterval drifts late, which would run the simulation below its tick rate and let client
    // inputs back up. Wake twice per tick and step by measured elapsed time instead.
    const room: Room = {
      code,
      settings,
      match,
      bots,
      questions,
      pendingMs: 0,
      lastLoopAt: performance.now(),
      timer: setInterval(() => this.runFixedSteps(room, tickMs), tickMs / 2),
    };
    room.timer.unref();
    this.rooms.set(code, room);
    this.balanceBots(room);
    return room;
  }

  private humansIn(room: Room): number {
    return room.match.playerCount - room.bots.count;
  }

  private balanceBots(room: Room): void {
    const before = new Set(room.bots.ids);
    room.bots.balance(this.humansIn(room), room.settings.rooms.maxPlayers);
    const after = room.bots.ids;
    for (const id of after) if (!before.has(id)) this.logger.log(`Bot ${id} joined ${room.code}`);
    for (const id of before) if (!after.includes(id)) this.logger.log(`Bot ${id} left ${room.code}`);
  }

  private closeRoom(room: Room): void {
    clearInterval(room.timer);
    this.rooms.delete(room.code);
    if (this.rooms.size === 0) this.stopStats();
    this.logger.log(`Closed room ${room.code}`);
  }

  private runFixedSteps(room: Room, tickMs: number): void {
    const now = performance.now();
    room.pendingMs += now - room.lastLoopAt;
    room.lastLoopAt = now;
    let steps = 0;
    while (room.pendingMs >= tickMs && steps < MAX_CATCH_UP_STEPS) {
      room.pendingMs -= tickMs;
      steps++;
      this.stepRoom(room);
    }
    if (room.pendingMs >= tickMs) room.pendingMs = 0; // stalled too long: drop the backlog rather than burst
  }

  private stepRoom(room: Room): void {
    const started = performance.now();
    try {
      room.bots.act();
      room.match.step();
    } catch (error) {
      this.logger.error(`Tick failed in room ${room.code}`, error instanceof Error ? error.stack : String(error));
    }
    if (this.tickDurations.length < 10_000) this.tickDurations.push(performance.now() - started);
  }

  private startStats(): void {
    if (this.statsTimer) return;
    this.loopDelay.enable();
    this.statsTimer = setInterval(() => this.logStats(), STATS_INTERVAL_MS);
    this.statsTimer.unref();
  }

  private stopStats(): void {
    if (!this.statsTimer) return;
    clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.loopDelay.disable();
  }

  private logStats(): void {
    const sorted = [...this.tickDurations].sort((a, b) => a - b);
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    this.logger.log(
      `ticks=${sorted.length} tick_p50=${p(0.5).toFixed(2)}ms tick_p99=${p(0.99).toFixed(2)}ms ` +
        `loop_lag_p99=${(this.loopDelay.percentile(99) / 1e6).toFixed(1)}ms rooms=${this.rooms.size}`,
    );
    this.tickDurations.length = 0;
    this.loopDelay.reset();
  }
}
