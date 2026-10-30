import type {
  HitConfirmed,
  PlayerSnapshot,
  ProjectileSpawned,
  QuestionPresented,
  ServerEventName,
  StateSnapshot,
} from '@volleyland/contracts';
import {
  type Arena,
  type GameConfig,
  type NavGrid,
  type Rng,
  type WeaponId,
  DEFAULT_WEAPON,
  buildNavGrid,
  createRng,
  enabledWeapons,
  findPath,
  flightBlocked,
  groundHeight,
  hashSeed,
  weaponRange,
  weaponStats,
} from '@volleyland/game-core';
import type { BotConfig } from '../config/bot-config.js';
import type { Match } from './match.js';

/** What a bot may do in its match: the commands a human's socket reaches, plus the answer key to pick right or wrong. */
export type BotMatch = Pick<Match, 'queueInput' | 'requestProjectile' | 'selectWeapon' | 'submitAnswer' | 'answerKeyFor' | 'announceWindup'>;

interface Point {
  x: number;
  z: number;
}

interface Sample extends Point {
  t: number;
}

/** How far back to look when estimating a target's velocity. */
const VELOCITY_WINDOW_MS = 200;
/** How often a bot plans a new route to its target, and how far the target may move before it re-plans sooner. */
const ROUTE_REFRESH_MS = 700;
const ROUTE_TARGET_SLACK = 3;
/** A waypoint counts as reached within this distance. */
const WAYPOINT_REACHED = 0.6;

/** One walkability grid per arena, shared by every bot in the match. */
const navGrids = new WeakMap<Arena, Map<string, NavGrid>>();
function navGridFor(arena: Arena, clearance: number, maxSlopeDeg: number): NavGrid {
  let byRules = navGrids.get(arena);
  if (!byRules) navGrids.set(arena, (byRules = new Map()));
  const key = `${clearance}:${maxSlopeDeg}`;
  let grid = byRules.get(key);
  if (!grid) byRules.set(key, (grid = buildNavGrid(arena, clearance, maxSlopeDeg)));
  return grid;
}
/** Chance a bot keeps the weapon in hand when it still reaches, rather than picking again. */
const KEEP_WEAPON_CHANCE = 0.6;
/** Ticks without moving before a bot gives up on its direction (it is pressed against cover or a wall). */
const STUCK_TICKS = 3;

/**
 * Where to aim so a projectile from `from` at `speed` meets a target moving at constant `velocity`.
 * Falls back to the target's position when it cannot be caught.
 */
export function leadPoint(from: Point, target: Point, velocity: Point, speed: number): Point {
  const px = target.x - from.x;
  const pz = target.z - from.z;
  const a = velocity.x ** 2 + velocity.z ** 2 - speed ** 2;
  const b = 2 * (px * velocity.x + pz * velocity.z);
  const c = px ** 2 + pz ** 2;
  let t: number;
  if (Math.abs(a) < 1e-9) {
    t = b < 0 ? -c / b : -1;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return target;
    const root = Math.sqrt(disc);
    const times = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter((x) => x > 0);
    t = times.length > 0 ? Math.min(...times) : -1;
  }
  if (!(t > 0)) return target;
  return { x: target.x + velocity.x * t, z: target.z + velocity.z * t };
}

const yawTo = (from: Point, to: Point): number => Math.atan2(to.x - from.x, to.z - from.z);

/**
 * One server-side bot. It sees the match the way a client does (snapshots and events) and acts
 * through the same Match commands, so every outcome is still decided by the match. It is
 * deliberately beatable: normal throws use a stale target position, no lead and a random error;
 * after `missesBeforeSureShot` misses in a row it stands still briefly, then throws one that leads.
 * Before a shot it picks, at random, one of the weapons that reach its target, so players meet every
 * weapon; it fires no faster than its fire interval, whatever the weapon's reload.
 */
export class Bot {
  private readonly rng: Rng;
  private seq = 0;
  private me: PlayerSnapshot | null = null;
  private others: PlayerSnapshot[] = [];
  private readonly history = new Map<string, Sample[]>();
  /** When each player last became hittable (alive and unprotected); absent while they are not. */
  private readonly hittableSince = new Map<string, number>();
  /** Our projectiles still flying, each with the shot it belongs to (a scatter shot is several). */
  private readonly inFlight = new Map<string, number>();
  private weapon: WeaponId = DEFAULT_WEAPON;
  private missStreak = 0;
  private move: Point = { x: 0, z: 0 };
  private nextWanderAt = 0;
  private lastPosition: Point | null = null;
  private stuckTicks = 0;
  private nextThrowAt: number;
  private windupUntil: number | null = null;
  private route: { points: Point[]; goal: Point; plannedAt: number } | null = null;
  private pendingAnswer: { encounterId: string; optionId: string; at: number } | null = null;

  constructor(
    readonly id: string,
    private readonly match: BotMatch,
    private readonly config: BotConfig,
    private readonly game: GameConfig,
    private readonly arena: Arena,
    private readonly now: () => number,
  ) {
    this.rng = createRng(hashSeed(`bot:${id}`));
    this.nextThrowAt = now() + this.between(config.fireIntervalMs);
  }

  /** Throws in a row that missed (resets on a hit). */
  get misses(): number {
    return this.missStreak;
  }

  /** True while standing still before a sure shot. */
  get windingUp(): boolean {
    return this.windupUntil !== null;
  }

  /** Feed one server event to the bot (room broadcasts and events addressed to it). */
  observe(event: ServerEventName, payload: unknown): void {
    switch (event) {
      case 'state.snapshot':
        this.onSnapshot(payload as StateSnapshot);
        break;
      case 'projectile.spawned': {
        const spawned = payload as ProjectileSpawned;
        // Every projectile of one shot spawns in the same tick.
        if (spawned.ownerId === this.id) this.inFlight.set(spawned.projectileId, spawned.tick);
        break;
      }
      case 'hit.confirmed': {
        const hit = payload as HitConfirmed;
        const shot = this.inFlight.get(hit.projectileId);
        if (shot === undefined) break;
        // The rest of a scatter shot that hit is not a miss.
        for (const [id, s] of this.inFlight) if (s === shot) this.inFlight.delete(id);
        this.missStreak = 0;
        break;
      }
      case 'question.presented':
        this.onQuestion(payload as QuestionPresented);
        break;
      case 'question.resolved':
        this.pendingAnswer = null;
        break;
      default:
        break;
    }
  }

  /** Decide this tick's commands. Call before the match steps so they apply this tick. */
  act(): void {
    const now = this.now();
    if (this.pendingAnswer && now >= this.pendingAnswer.at) {
      this.match.submitAnswer(this.id, this.pendingAnswer.encounterId, this.pendingAnswer.optionId);
      this.pendingAnswer = null;
    }
    const me = this.me;
    if (!me || me.status !== 'alive') {
      this.windupUntil = null;
      return;
    }

    const target = this.pickTarget(me);
    const shootable = target !== null && this.canShoot(me, target, now);
    let move: Point = { x: 0, z: 0 };

    if (this.windupUntil !== null) {
      // Standing still is the tell that a sure shot is coming.
      if (!shootable) this.windupUntil = null;
      else if (now >= this.windupUntil) {
        this.throwAt(me, target, true, now);
        this.windupUntil = null;
      }
    } else {
      move = this.wander(me, target, now);
      if (shootable && now >= this.nextThrowAt) {
        const sureShotDue = this.config.missesBeforeSureShot > 0 && this.missStreak >= this.config.missesBeforeSureShot;
        const distance = Math.hypot(target.x - me.x, target.z - me.z);
        if (sureShotDue) {
          // The wind-up is longer than a weapon switch, so the sure shot can use the best weapon for the range.
          this.equip(this.chooseWeapon(distance, false), now);
          this.windupUntil = now + this.config.sureShotWindupMs;
          move = { x: 0, z: 0 };
          this.match.announceWindup(this.id, target.id);
        } else if (!this.equip(this.chooseWeapon(distance, true), now)) {
          // After a switch the shot waits until the new weapon is ready (equip moved nextThrowAt).
          this.throwAt(me, target, false, now);
        }
      }
    }

    const yaw = target ? yawTo(me, this.positionNow(target, now)) : me.yaw;
    this.match.queueInput(this.id, { seq: this.seq++, moveX: move.x, moveZ: move.z, yaw });
  }

  private onSnapshot(snapshot: StateSnapshot): void {
    this.me = snapshot.players.find((p) => p.id === this.id) ?? null;
    this.others = snapshot.players.filter((p) => p.id !== this.id);

    const keepAfter = snapshot.serverTime - Math.max(this.config.reactionMs, VELOCITY_WINDOW_MS) - 500;
    for (const player of this.others) {
      const samples = this.history.get(player.id) ?? [];
      samples.push({ t: snapshot.serverTime, x: player.x, z: player.z });
      while (samples.length > 1 && samples[0]!.t < keepAfter) samples.shift();
      this.history.set(player.id, samples);
    }
    for (const id of this.history.keys()) {
      if (!this.others.some((p) => p.id === id)) this.history.delete(id);
    }
    for (const player of this.others) {
      const hittable = player.status === 'alive' && !player.protected;
      if (!hittable) this.hittableSince.delete(player.id);
      else if (!this.hittableSince.has(player.id)) this.hittableSince.set(player.id, snapshot.serverTime);
    }

    // A shot of ours whose projectiles all left the snapshot without a hit.confirmed missed.
    const live = new Set(snapshot.projectiles.map((p) => p.id));
    for (const [id, shot] of this.inFlight) {
      if (live.has(id)) continue;
      this.inFlight.delete(id);
      if (![...this.inFlight.values()].includes(shot)) this.missStreak++;
    }
  }

  private onQuestion(question: QuestionPresented): void {
    if (question.targetId !== this.id) return;
    const key = this.match.answerKeyFor(this.id, question.encounterId);
    const wrong = question.options.filter((o) => o.id !== key);
    const correct = key !== null && (this.rng() < this.config.answerCorrectChance || wrong.length === 0);
    const optionId = correct ? key : wrong[Math.floor(this.rng() * wrong.length)]!.id;
    const tickMs = 1000 / this.game.tickRate;
    const at = Math.min(this.now() + this.between(this.config.answerDelayMs), question.deadline - tickMs);
    this.pendingAnswer = { encounterId: question.encounterId, optionId, at };
  }

  /** The nearest player who is not dead, preferring ones that can be hit right now. */
  private pickTarget(me: PlayerSnapshot): PlayerSnapshot | null {
    const present = this.others.filter((p) => p.status !== 'dead');
    const hittable = present.filter((p) => p.status === 'alive' && !p.protected);
    const pool = hittable.length > 0 ? hittable : present;
    let best: PlayerSnapshot | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const p of pool) {
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  private canShoot(me: PlayerSnapshot, target: PlayerSnapshot, now: number): boolean {
    // A player who just unfroze or respawned gets the bot's reaction time to move before it throws.
    const since = this.hittableSince.get(target.id);
    if (since === undefined || now - since < this.config.reactionMs) return false;
    const range = Math.max(...enabledWeapons(this.game).map((w) => this.reach(w)));
    if (Math.hypot(target.x - me.x, target.z - me.z) > range) return false;
    return this.lineIsClear(me, target);
  }

  /** How far the bot will shoot with a weapon: a fraction of its full range. */
  private reach(weapon: WeaponId): number {
    return weaponRange(weaponStats(this.game, weapon)) * this.config.maxRangeFactor;
  }

  /**
   * A weapon that reaches `distance`: at random among those that do (`varied`, often keeping the
   * one in hand), or the one that does with the fastest shot (a sure shot). The longest-reaching
   * one when none does.
   */
  private chooseWeapon(distance: number, varied: boolean): WeaponId {
    const weapons = enabledWeapons(this.game);
    const reaching = weapons.filter((w) => this.reach(w) >= distance);
    if (reaching.length === 0) return weapons.reduce((best, w) => (this.reach(w) > this.reach(best) ? w : best));
    if (!varied) return reaching.reduce((best, w) => (weaponStats(this.game, w).speed > weaponStats(this.game, best).speed ? w : best));
    if (reaching.includes(this.weapon) && this.rng() < KEEP_WEAPON_CHANCE) return this.weapon;
    return reaching[Math.floor(this.rng() * reaching.length)]!;
  }

  /** Switch to `weapon` if it is not in hand. Returns whether it switched. */
  private equip(weapon: WeaponId, now: number): boolean {
    if (weapon === this.weapon || !this.match.selectWeapon(this.id, weapon).ok) return false;
    this.weapon = weapon;
    this.nextThrowAt = Math.max(this.nextThrowAt, now + this.game.weaponSwitchMs);
    return true;
  }

  /** Whether a throw from `from` would reach `to` without hitting a prop or a hill (low props it flies over don't count). */
  private lineIsClear(from: Point, to: Point): boolean {
    return !flightBlocked(this.arena, this.handAt(from), this.handAt(to), this.game.projectileRadius);
  }

  /** Where a throw leaves (or meets) a player standing at a floor point: hand height above the ground. */
  private handAt(p: Point): { x: number; y: number; z: number } {
    return { x: p.x, y: groundHeight(this.arena, p.x, p.z) + this.game.projectileHeight, z: p.z };
  }

  /**
   * Walk a planned route towards the target, round cover. Used when the target is out of range or
   * behind cover; re-planned every ROUTE_REFRESH_MS, or sooner when the target moves away.
   */
  private followRoute(me: PlayerSnapshot, target: Point, now: number): Point {
    const stale =
      !this.route ||
      now - this.route.plannedAt > ROUTE_REFRESH_MS ||
      Math.hypot(target.x - this.route.goal.x, target.z - this.route.goal.z) > ROUTE_TARGET_SLACK;
    if (stale) {
      const grid = navGridFor(this.arena, this.game.playerRadius + 0.1, this.game.maxSlopeDeg);
      this.route = { points: findPath(grid, me, target), goal: { x: target.x, z: target.z }, plannedAt: now };
    }
    const points = this.route!.points;
    while (points.length > 1 && Math.hypot(points[0]!.x - me.x, points[0]!.z - me.z) < WAYPOINT_REACHED) points.shift();
    const next = points[0];
    if (!next) return { x: 0, z: 0 };
    const dx = next.x - me.x;
    const dz = next.z - me.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return { x: 0, z: 0 };
    return { x: (dx / d) * this.config.moveSpeedFactor, z: (dz / d) * this.config.moveSpeedFactor };
  }

  private throwAt(me: PlayerSnapshot, target: PlayerSnapshot, sure: boolean, now: number): void {
    const stats = weaponStats(this.game, this.weapon);
    let aim: Point;
    if (sure) {
      aim = leadPoint(me, this.positionNow(target, now), this.velocityOf(target.id), stats.speed);
    } else {
      const seen = this.positionAt(target.id, now - this.config.reactionMs) ?? target;
      aim = this.config.leadTarget ? leadPoint(me, seen, this.velocityOf(target.id), stats.speed) : seen;
    }
    const error = sure ? 0 : (this.rng() * 2 - 1) * this.config.aimErrorDeg * (Math.PI / 180);
    // Up or down hill: aim at the same hand height above the ground where the target will be.
    const from = this.handAt(me);
    const to = this.handAt(aim);
    const pitch = Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));
    this.match.requestProjectile(this.id, yawTo(me, aim) + error, pitch);
    this.nextThrowAt = now + Math.max(this.between(this.config.fireIntervalMs), stats.cooldownMs);
  }

  /** Strafe around the target, closing in or backing off to stay in the preferred range; walk round cover to reach it. */
  private wander(me: PlayerSnapshot, target: PlayerSnapshot | null, now: number): Point {
    const moving = this.move.x !== 0 || this.move.z !== 0;
    if (this.lastPosition && moving && Math.hypot(me.x - this.lastPosition.x, me.z - this.lastPosition.z) < 0.01) {
      this.stuckTicks++;
    } else {
      this.stuckTicks = 0;
    }
    this.lastPosition = { x: me.x, z: me.z };

    // Out of range or behind cover: walk round to the target instead of strafing into a wall.
    const far = target !== null && Math.hypot(target.x - me.x, target.z - me.z) > this.config.preferredRange[1];
    if (target && (far || !this.lineIsClear(me, target)) && this.stuckTicks < STUCK_TICKS) {
      this.move = this.followRoute(me, target, now);
      return this.move;
    }
    this.route = null;

    const stuck = this.stuckTicks >= STUCK_TICKS;
    if (now >= this.nextWanderAt || stuck) {
      this.nextWanderAt = now + this.between(this.config.wanderChangeMs);
      this.stuckTicks = 0;
      let dir: Point;
      if (target && !stuck) {
        const dx = target.x - me.x;
        const dz = target.z - me.z;
        const d = Math.hypot(dx, dz) || 1;
        const [near, far] = this.config.preferredRange;
        const toward = d > far ? 1 : d < near ? -1 : 0;
        const side = this.rng() < 0.5 ? -1 : 1;
        dir = { x: (toward * dx + side * dz) / d, z: (toward * dz - side * dx) / d };
      } else {
        const angle = this.rng() * Math.PI * 2;
        dir = { x: Math.sin(angle), z: Math.cos(angle) };
      }
      const len = Math.hypot(dir.x, dir.z) || 1;
      this.move = { x: (dir.x / len) * this.config.moveSpeedFactor, z: (dir.z / len) * this.config.moveSpeedFactor };
    }
    return this.move;
  }

  /** Where the bot saw a player at time `t` (the latest sample at or before it). */
  private positionAt(playerId: string, t: number): Point | null {
    const samples = this.history.get(playerId);
    if (!samples || samples.length === 0) return null;
    let found = samples[0]!;
    for (const s of samples) if (s.t <= t) found = s;
    return found;
  }

  private velocityOf(playerId: string): Point {
    const samples = this.history.get(playerId);
    if (!samples || samples.length < 2) return { x: 0, z: 0 };
    const latest = samples.at(-1)!;
    const earlier = samples.find((s) => s.t >= latest.t - VELOCITY_WINDOW_MS)!;
    const dt = (latest.t - earlier.t) / 1000;
    return dt > 0 ? { x: (latest.x - earlier.x) / dt, z: (latest.z - earlier.z) / dt } : { x: 0, z: 0 };
  }

  /** The latest snapshot position, projected forward to `now`. */
  private positionNow(target: PlayerSnapshot, now: number): Point {
    const latest = this.history.get(target.id)?.at(-1);
    if (!latest) return target;
    const v = this.velocityOf(target.id);
    const dt = (now - latest.t) / 1000;
    return { x: latest.x + v.x * dt, z: latest.z + v.z * dt };
  }

  private between([min, max]: readonly [number, number]): number {
    return min + this.rng() * (max - min);
  }
}
