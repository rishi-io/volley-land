import { randomUUID } from 'node:crypto';
import {
  type MatchSetup,
  type PlayerSnapshot,
  type SettingChange,
  PROTOCOL_VERSION,
  type RejectionCode,
  type ServerEventName,
  type ServerToClientEvents,
} from '@volleyland/contracts';
import {
  type Arena,
  type GameConfig,
  type Vec3,
  type WeaponId,
  DEFAULT_WEAPON,
  MAX_THROW_PITCH,
  add,
  capsuleIntersectsCapsule,
  clamp,
  closestPointOnSegment,
  directionFromAngles,
  distanceSq,
  playerCapsule,
  flightBlocked,
  scale,
  shotYaws,
  stepMovement,
  weaponStats,
} from '@volleyland/game-core';
import { type Encounter, evaluateAnswer, expireEncounter, openEncounter, publicOptions } from '../question-selection/encounter.js';
import type { QuestionSelector } from '../question-selection/question-selector.js';

type Payload<E extends ServerEventName> = Parameters<ServerToClientEvents[E]>[0];
/** Fields every server event carries; the match fills them in. */
type Envelope = 'v' | 'matchId' | 'msgId' | 'serverTime' | 'tick';
export type EventBody<E extends ServerEventName> = Omit<Payload<E>, Envelope>;

/** Where match events go. Transport-independent: the gateway adapts it to Socket.IO rooms. */
export interface MatchEventSink {
  toRoom<E extends ServerEventName>(event: E, payload: Payload<E>): void;
  toPlayer<E extends ServerEventName>(playerId: string, event: E, payload: Payload<E>): void;
}

export interface MovementCommand {
  seq: number;
  moveX: number;
  moveZ: number;
  yaw: number;
}

/** A throw waiting behind the movement inputs that were sent before it. */
interface QueuedThrow {
  throw: true;
  weapon: WeaponId;
  yaw: number;
  pitch: number;
}

export type CommandResult = { ok: true } | { ok: false; code: RejectionCode; message: string };

interface PlayerState {
  id: string;
  position: Vec3;
  yaw: number;
  health: number;
  status: 'alive' | 'frozen' | 'dead';
  protectedUntil: number;
  respawnAt: number | null;
  /** Movement inputs waiting for credit, and throws sent after them (which wait their turn). */
  inputQueue: (MovementCommand | QueuedThrow)[];
  inputCredits: number;
  lastInputSeq: number;
  /** The weapon in hand, and when each weapon last fired. */
  weapon: WeaponId;
  lastShotAt: Partial<Record<WeaponId, number>>;
  /** After a switch, the new weapon cannot fire before this. */
  weaponReadyAt: number;
  bot: boolean;
  /** Appearance slot: the lowest one free when the player joined, kept until they leave. */
  look: number;
}

interface Projectile {
  id: string;
  ownerId: string;
  weapon: WeaponId;
  radius: number;
  position: Vec3;
  velocity: Vec3;
  expiresAt: number;
}

const MAX_QUEUED_INPUTS = 8;
const ok: CommandResult = { ok: true };
const reject = (code: RejectionCode, message: string): CommandResult => ({ ok: false, code, message });

/**
 * One authoritative match. The server decides every outcome here: movement is re-simulated from
 * inputs under a per-tick budget, hits are detected server-side, and each hit opens exactly one
 * question encounter that only the server can resolve.
 */
export class Match {
  private readonly players = new Map<string, PlayerState>();
  private readonly projectiles = new Map<string, Projectile>();
  private readonly encounters = new Map<string, Encounter>();
  private tickNumber = 0;
  private projectileCounter = 0;
  private encounterCounter = 0;

  constructor(
    readonly id: string,
    private readonly config: GameConfig,
    private readonly arena: Arena,
    private readonly questions: QuestionSelector,
    private readonly events: MatchEventSink,
    private readonly now: () => number,
  ) {}

  get tick(): number {
    return this.tickNumber;
  }

  get playerCount(): number {
    return this.players.size;
  }

  /** IDs of the human (non-bot) players, in the order they joined. */
  get humanIds(): string[] {
    return [...this.players.values()].filter((p) => !p.bot).map((p) => p.id);
  }

  /** Tell everyone in the room how this match is set up now, and which admin changes led to it. */
  announceSetup(setup: MatchSetup, changes: SettingChange[]): void {
    this.events.toRoom('match.setup', { ...this.envelope(), setup, changes });
  }

  addPlayer(playerId: string, options: { bot?: boolean } = {}): void {
    const now = this.now();
    const taken = new Set([...this.players.values()].map((p) => p.look));
    let look = 0;
    while (taken.has(look)) look++;
    this.players.set(playerId, {
      id: playerId,
      position: this.chooseSpawnPoint(playerId),
      yaw: 0,
      health: this.config.startingHealth,
      status: 'alive',
      protectedUntil: now + this.config.spawnProtectionMs,
      respawnAt: null,
      inputQueue: [],
      inputCredits: this.config.maxInputCredits,
      lastInputSeq: -1,
      weapon: DEFAULT_WEAPON,
      lastShotAt: {},
      weaponReadyAt: Number.NEGATIVE_INFINITY,
      bot: options.bot ?? false,
      look,
    });
  }

  removePlayer(playerId: string): void {
    this.players.delete(playerId);
    for (const [id, encounter] of this.encounters) {
      if (encounter.targetId === playerId) this.encounters.delete(id);
    }
  }

  queueInput(playerId: string, command: MovementCommand): CommandResult {
    const player = this.players.get(playerId);
    if (!player) return reject('not_in_room', 'Player is not in this match');
    if (player.inputQueue.length >= MAX_QUEUED_INPUTS) return reject('rate_limited', 'Too many queued inputs');
    player.inputQueue.push(command);
    return ok;
  }

  /**
   * Put another weapon in the player's hand. It can fire once the switch time has passed (so
   * switching never skips a reload); each weapon keeps its own reload. Allowed while frozen or
   * knocked out, so a player can get ready.
   */
  selectWeapon(playerId: string, weapon: WeaponId): CommandResult {
    const player = this.players.get(playerId);
    if (!player) return reject('not_in_room', 'Player is not in this match');
    if (!weaponStats(this.config, weapon).enabled) return reject('not_allowed', `The ${weapon} is turned off in this match`);
    if (player.weapon === weapon) return ok;
    player.weapon = weapon;
    player.weaponReadyAt = this.now() + this.config.weaponSwitchMs;
    return ok;
  }

  /** The weapon a player is holding (for bots, which choose by range). */
  weaponOf(playerId: string): WeaponId | null {
    return this.players.get(playerId)?.weapon ?? null;
  }

  /**
   * Fire the weapon in hand along `yaw`, tilted up (positive) or down by `pitch`, from hand height.
   * The shot leaves from where the player was when they fired: if movement inputs they sent
   * before it are still queued, it waits behind them, so a player who fires while running fires
   * from the spot they saw (and aimed from), not from where the server had got to.
   */
  requestProjectile(playerId: string, yaw: number, pitch = 0): CommandResult {
    const player = this.players.get(playerId);
    if (!player) return reject('not_in_room', 'Player is not in this match');
    if (player.status !== 'alive') return reject('not_allowed', `Cannot throw while ${player.status}`);
    const now = this.now();
    const { weapon } = player;
    if (now < player.weaponReadyAt) return reject('rate_limited', 'Still switching weapon');
    const last = player.lastShotAt[weapon] ?? Number.NEGATIVE_INFINITY;
    if (now - last < weaponStats(this.config, weapon).cooldownMs) return reject('rate_limited', 'Throw on cooldown');

    player.lastShotAt[weapon] = now;
    if (player.inputQueue.length > 0) player.inputQueue.push({ throw: true, weapon, yaw, pitch });
    else this.spawnShot(player, weapon, yaw, pitch, now);
    return ok;
  }

  /** One shot: a single projectile, or a scatter's fan of them, all from the same hand. */
  private spawnShot(player: PlayerState, weapon: WeaponId, yaw: number, pitch: number, now: number): void {
    const stats = weaponStats(this.config, weapon);
    for (const shotYaw of shotYaws(yaw, stats)) {
      const direction = directionFromAngles(shotYaw, clamp(pitch, -MAX_THROW_PITCH, MAX_THROW_PITCH));
      const muzzle = this.config.playerRadius + stats.radius + 0.05;
      const position = add({ ...player.position, y: player.position.y + this.config.projectileHeight }, scale(direction, muzzle));
      const projectile: Projectile = {
        id: `pr${++this.projectileCounter}`,
        ownerId: player.id,
        weapon,
        radius: stats.radius,
        position,
        velocity: scale(direction, stats.speed),
        expiresAt: now + stats.lifetimeMs,
      };
      this.projectiles.set(projectile.id, projectile);
      this.events.toRoom('projectile.spawned', {
        ...this.envelope(),
        projectileId: projectile.id,
        ownerId: player.id,
        weapon,
        x: position.x,
        y: position.y,
        z: position.z,
        vx: projectile.velocity.x,
        vy: projectile.velocity.y,
        vz: projectile.velocity.z,
      });
    }
  }

  submitAnswer(playerId: string, encounterId: string, optionId: string): CommandResult {
    const encounter = this.encounters.get(encounterId);
    if (!encounter || encounter.targetId !== playerId) return reject('not_allowed', 'No open question for this player');
    const result = evaluateAnswer(encounter, optionId, this.now());
    if (!result.accepted) return reject('not_allowed', result.reason === 'unknown_option' ? 'Unknown option' : 'Already answered');
    this.resolveEncounter(encounter);
    return ok;
  }

  /**
   * The correct option of a player's open question, for server-side bots choosing to answer
   * right or wrong. Never expose this to a transport: the answer key stays on the server.
   */
  answerKeyFor(playerId: string, encounterId: string): string | null {
    const encounter = this.encounters.get(encounterId);
    return encounter && encounter.targetId === playerId ? encounter.question.correctOptionId : null;
  }

  /**
   * A bot announces that it stopped to line up a sure shot, so clients can play its warning line.
   * Only bots announce, only while alive, and only at a player in this match.
   */
  announceWindup(botId: string, targetId: string): CommandResult {
    const bot = this.players.get(botId);
    if (!bot || !bot.bot) return reject('not_allowed', 'Only bots announce a windup');
    if (bot.status !== 'alive') return reject('not_allowed', `Cannot wind up while ${bot.status}`);
    if (!this.players.has(targetId)) return reject('not_in_room', 'Target is not in this match');
    this.events.toRoom('bot.windup', { ...this.envelope(), playerId: botId, targetId });
    return ok;
  }

  /** Advance the simulation one fixed step. */
  step(): void {
    const now = this.now();
    this.tickNumber++;
    this.applyInputs(now);
    this.moveProjectiles(now);
    // Deadlines are capped at freezeMaxMs when opened, so expiry also ends the freeze.
    for (const encounter of this.encounters.values()) {
      if (expireEncounter(encounter, now)) this.resolveEncounter(encounter);
    }
    for (const player of this.players.values()) {
      if (player.status === 'dead' && player.respawnAt !== null && now >= player.respawnAt) this.respawn(player, now);
    }
    this.events.toRoom('state.snapshot', {
      ...this.envelope(),
      players: [...this.players.values()].map((p) => this.snapshotOf(p, now)),
      projectiles: [...this.projectiles.values()].map((p) => ({ id: p.id, x: p.position.x, y: p.position.y, z: p.position.z, weapon: p.weapon })),
    });
  }

  private applyInputs(now: number): void {
    const dt = this.config.inputStepMs / 1000;
    for (const player of this.players.values()) {
      // One input step of credit per tick: jitter can be absorbed, but never more movement than real time allows.
      player.inputCredits = Math.min(this.config.maxInputCredits, player.inputCredits + 1);
      while (player.inputQueue.length > 0 && ('throw' in player.inputQueue[0]! || player.inputCredits >= 1)) {
        const command = player.inputQueue.shift()!;
        if ('throw' in command) {
          // Its turn: the inputs sent before it have moved the player. A hit since then dropped it (the queue is cleared).
          if (player.status === 'alive') this.spawnShot(player, command.weapon, command.yaw, command.pitch, now);
          continue;
        }
        player.inputCredits--;
        player.lastInputSeq = command.seq;
        if (player.status !== 'alive') continue; // acknowledged but not applied: frozen and dead players do not move
        player.position = stepMovement(player.position, command, dt, this.config, this.arena);
        player.yaw = command.yaw;
      }
    }
  }

  private moveProjectiles(now: number): void {
    const dt = 1 / this.config.tickRate;
    for (const projectile of this.projectiles.values()) {
      const from = projectile.position;
      const to = add(from, scale(projectile.velocity, dt));
      const swept = { a: from, b: to, radius: projectile.radius };

      const target = this.firstHitPlayer(projectile, swept, now);
      // A prop or the ground between the throw and the player it reached this tick takes the hit instead.
      if (target) {
        const body = playerCapsule(target.position, this.config.playerRadius, this.config.playerHeight);
        if (!flightBlocked(this.arena, from, closestPointOnSegment(from, body.a, body.b), projectile.radius)) {
          this.projectiles.delete(projectile.id);
          this.openEncounter(projectile, target, now);
          continue;
        }
      }
      const blocked = flightBlocked(this.arena, from, to, projectile.radius);
      const outOfBounds = Math.abs(to.x) > this.arena.halfWidth || Math.abs(to.z) > this.arena.halfDepth;
      if (blocked || outOfBounds || now >= projectile.expiresAt) {
        this.projectiles.delete(projectile.id);
        continue;
      }
      projectile.position = to;
    }
  }

  private firstHitPlayer(projectile: Projectile, swept: { a: Vec3; b: Vec3; radius: number }, now: number): PlayerState | null {
    let closest: PlayerState | null = null;
    let closestDistSq = Number.POSITIVE_INFINITY;
    for (const player of this.players.values()) {
      if (player.id === projectile.ownerId || !this.isHittable(player, now)) continue;
      const body = playerCapsule(player.position, this.config.playerRadius, this.config.playerHeight);
      if (!capsuleIntersectsCapsule(swept, body)) continue;
      const d = distanceSq(swept.a, player.position);
      if (d < closestDistSq) {
        closest = player;
        closestDistSq = d;
      }
    }
    return closest;
  }

  private isHittable(player: PlayerState, now: number): boolean {
    return player.status === 'alive' && now >= player.protectedUntil;
  }

  private openEncounter(projectile: Projectile, target: PlayerState, now: number): void {
    const encounter = openEncounter({
      id: `${this.id}:e${++this.encounterCounter}`,
      targetId: target.id,
      shooterId: projectile.ownerId,
      question: this.questions.select(target.id),
      now,
      answerTimeMs: Math.min(this.config.answerTimeMs, this.config.freezeMaxMs),
    });
    this.encounters.set(encounter.id, encounter);
    target.status = 'frozen';
    target.inputQueue.length = 0;

    this.events.toRoom('hit.confirmed', {
      ...this.envelope(),
      projectileId: projectile.id,
      shooterId: projectile.ownerId,
      targetId: target.id,
      encounterId: encounter.id,
    });
    this.events.toPlayer(target.id, 'question.presented', {
      ...this.envelope(),
      encounterId: encounter.id,
      targetId: target.id,
      prompt: encounter.question.prompt,
      options: publicOptions(encounter),
      deadline: encounter.deadline,
      answerTimeMs: encounter.deadline - encounter.presentedAt,
    });
  }

  private resolveEncounter(encounter: Encounter): void {
    this.encounters.delete(encounter.id);
    const target = this.players.get(encounter.targetId);
    const outcome = encounter.outcome!;
    const now = this.now();
    const resolved = {
      ...this.envelope(),
      encounterId: encounter.id,
      targetId: encounter.targetId,
      outcome,
      selectedOptionId: encounter.selectedOptionId,
    };
    // The answer key and explanation go only to the player who answered, and only now.
    this.events.toPlayer(encounter.targetId, 'question.resolved', {
      ...resolved,
      correctOptionId: encounter.question.correctOptionId,
      explanation: encounter.question.explanation,
    });
    if (!target) return;

    if (outcome === 'correct') {
      target.status = 'alive';
      target.protectedUntil = now + this.config.correctAnswerShieldMs;
      return;
    }
    const damage = Math.min(target.health, this.config.wrongAnswerDamage);
    target.health -= damage;
    this.events.toRoom('health.changed', {
      ...this.envelope(),
      playerId: target.id,
      health: target.health,
      delta: -damage,
      reason: outcome,
    });
    if (target.health <= 0) {
      target.status = 'dead';
      target.respawnAt = now + this.config.respawnMs;
    } else {
      target.status = 'alive';
    }
  }

  private respawn(player: PlayerState, now: number): void {
    player.position = this.chooseSpawnPoint(player.id);
    player.health = this.config.startingHealth;
    player.status = 'alive';
    player.respawnAt = null;
    player.protectedUntil = now + this.config.spawnProtectionMs;
    player.inputQueue.length = 0;
    this.events.toRoom('player.respawned', {
      ...this.envelope(),
      playerId: player.id,
      x: player.position.x,
      z: player.position.z,
      health: player.health,
      protectedUntil: player.protectedUntil,
    });
    this.events.toRoom('health.changed', {
      ...this.envelope(),
      playerId: player.id,
      health: player.health,
      delta: player.health,
      reason: 'respawn',
    });
  }

  /**
   * Where a (re)spawning player appears: the spawn point nearest the action that is still out of
   * ball range of every other living player (spawn protection covers the rail's longer reach). In a big world that keeps players from spawning
   * on the far side of the map; when no point is out of range, the farthest one. Ties go to the
   * earliest point.
   */
  private chooseSpawnPoint(forPlayerId: string): Vec3 {
    const others = [...this.players.values()].filter((p) => p.id !== forPlayerId && p.status !== 'dead');
    const safe = this.config.projectileSpeed * (this.config.projectileLifetimeMs / 1000);
    const scored = this.arena.spawnPoints.map((point) => ({
      point,
      nearest: others.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...others.map((o) => Math.sqrt(distanceSq(point, o.position)))),
    }));
    const outOfRange = scored.filter((s) => s.nearest >= safe);
    const pick = outOfRange.length > 0
      ? outOfRange.reduce((best, s) => (s.nearest < best.nearest ? s : best))
      : scored.reduce((best, s) => (s.nearest > best.nearest ? s : best));
    return { ...pick.point };
  }

  private snapshotOf(player: PlayerState, now: number): PlayerSnapshot {
    return {
      id: player.id,
      x: player.position.x,
      z: player.position.z,
      yaw: player.yaw,
      health: player.health,
      status: player.status,
      protected: !this.isHittable(player, now),
      lastInputSeq: player.lastInputSeq,
      bot: player.bot,
      look: player.look,
      weapon: player.weapon,
    };
  }

  private envelope() {
    return {
      v: PROTOCOL_VERSION,
      matchId: this.id,
      msgId: randomUUID(),
      serverTime: this.now(),
      tick: this.tickNumber,
    };
  }
}
