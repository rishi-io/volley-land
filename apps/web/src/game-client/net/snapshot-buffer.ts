import type { StateSnapshot } from '@volleyland/contracts';

export interface Sampled {
  x: number;
  z: number;
  yaw: number;
}

export interface SampledProjectile {
  x: number;
  y: number;
  z: number;
}

export interface SampleResult {
  players: Map<string, Sampled>;
  projectiles: Map<string, SampledProjectile>;
  /** True when render time ran past the newest snapshot (the buffer starved). */
  starved: boolean;
}

const MAX_SNAPSHOTS = 32;

/** Shortest-arc angle interpolation so yaw never spins the long way round. */
function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Buffered authoritative snapshots, sampled at a render time slightly in the past so remote
 * entities move smoothly between two known server states instead of jumping every tick.
 */
export class SnapshotBuffer {
  private readonly snapshots: StateSnapshot[] = [];

  push(snapshot: StateSnapshot): void {
    const last = this.snapshots.at(-1);
    if (last && snapshot.tick <= last.tick) return; // out-of-order or duplicate
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
  }

  get latest(): StateSnapshot | undefined {
    return this.snapshots.at(-1);
  }

  clear(): void {
    this.snapshots.length = 0;
  }

  sample(renderTime: number): SampleResult {
    const result: SampleResult = { players: new Map(), projectiles: new Map(), starved: false };
    const n = this.snapshots.length;
    if (n === 0) return result;

    let older = this.snapshots[0]!;
    let newer = older;
    if (renderTime >= this.snapshots[n - 1]!.serverTime) {
      older = newer = this.snapshots[n - 1]!;
      result.starved = n > 1 && renderTime > newer.serverTime;
    } else {
      for (let i = n - 1; i > 0; i--) {
        if (this.snapshots[i - 1]!.serverTime <= renderTime) {
          older = this.snapshots[i - 1]!;
          newer = this.snapshots[i]!;
          break;
        }
      }
    }
    const span = newer.serverTime - older.serverTime;
    const t = span > 0 ? Math.min(1, Math.max(0, (renderTime - older.serverTime) / span)) : 1;

    const olderPlayers = new Map(older.players.map((p) => [p.id, p]));
    for (const p of newer.players) {
      const from = olderPlayers.get(p.id) ?? p;
      result.players.set(p.id, { x: from.x + (p.x - from.x) * t, z: from.z + (p.z - from.z) * t, yaw: lerpAngle(from.yaw, p.yaw, t) });
    }
    const olderProjectiles = new Map(older.projectiles.map((p) => [p.id, p]));
    for (const p of newer.projectiles) {
      const from = olderProjectiles.get(p.id) ?? p;
      result.projectiles.set(p.id, { x: from.x + (p.x - from.x) * t, y: from.y + (p.y - from.y) * t, z: from.z + (p.z - from.z) * t });
    }
    return result;
  }
}

/**
 * Estimates the server clock from snapshot timestamps. Keeps the smallest observed offset
 * (least network delay), relaxing slowly so a clock drift is followed.
 */
export class ServerClock {
  private offset: number | null = null;

  observe(serverTime: number, localNow: number): void {
    const sample = serverTime - localNow;
    if (this.offset === null || sample > this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.01;
  }

  now(localNow: number): number {
    return localNow + (this.offset ?? 0);
  }

  get ready(): boolean {
    return this.offset !== null;
  }
}
