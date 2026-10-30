import type { StateSnapshot } from '@volleyland/contracts';
import { type Arena, type WeaponId, flightBlocked, groundHeight } from '@volleyland/game-core';
import type { Entity, World } from 'koota';
import type { SampleResult } from '../net/snapshot-buffer';
import { Anim, Held, IsLocal, IsPlayer, IsProjectile, Look, NetId, PredictedProjectile, Shot, Transform, Vitals } from './traits';

/** Tracks which Koota entity mirrors which server entity. */
export class EntityIndex {
  readonly players = new Map<string, Entity>();
  readonly projectiles = new Map<string, Entity>();
  /** Server projectiles of our own throws, drawn by their predicted copy instead (kept hidden until they are gone). */
  readonly ownProjectiles = new Set<string>();
}

/**
 * Mirror the authoritative world into Koota for this frame: spawn and despawn entities to match
 * the newest snapshot, then write interpolated transforms (remote) or the prediction (local).
 * Players stand on the ground, so their height comes from the arena, not the snapshot.
 */
export function syncWorld(
  world: World,
  index: EntityIndex,
  latest: StateSnapshot,
  sample: SampleResult,
  localPlayerId: string | null,
  localPosition: { x: number; z: number } | null,
  localYaw: number,
  arena: Arena,
  localWeapon: WeaponId,
): void {
  const alive = new Set<string>();
  for (const p of latest.players) {
    alive.add(p.id);
    let entity = index.players.get(p.id);
    if (!entity) {
      const traits = [IsPlayer, NetId({ id: p.id }), Look({ look: p.look, bot: p.bot }), Anim, Held, Transform, Vitals] as const;
      entity = p.id === localPlayerId ? world.spawn(IsLocal, ...traits) : world.spawn(...traits);
      index.players.set(p.id, entity);
    }
    entity.set(Vitals, { health: p.health, status: p.status, protected: p.protected });
    // Our own switch shows at once; the server's copy of it arrives a round trip later.
    const weapon = p.id === localPlayerId ? localWeapon : p.weapon;
    if (entity.get(Held)!.weapon !== weapon) entity.set(Held, { weapon });
    const drawn = p.id === localPlayerId && localPosition ? { x: localPosition.x, z: localPosition.z, yaw: localYaw } : sample.players.get(p.id);
    if (drawn) entity.set(Transform, { x: drawn.x, y: groundHeight(arena, drawn.x, drawn.z), z: drawn.z, yaw: drawn.yaw });
  }
  for (const [id, entity] of index.players) {
    if (!alive.has(id)) {
      entity.destroy();
      index.players.delete(id);
    }
  }

  // Our own throws are drawn by their predicted copies, which are where the throw is now.
  world.query(PredictedProjectile).forEach((entity) => {
    const id = entity.get(PredictedProjectile)!.serverId;
    if (id !== '') index.ownProjectiles.add(id);
  });
  const visible = new Set([...sample.projectiles.keys()].filter((id) => !index.ownProjectiles.has(id)));
  for (const id of index.ownProjectiles) if (!sample.projectiles.has(id)) index.ownProjectiles.delete(id);
  const weapons = new Map(latest.projectiles.map((p) => [p.id, p.weapon]));
  for (const [id, position] of sample.projectiles) {
    if (!visible.has(id)) continue;
    let entity = index.projectiles.get(id);
    if (!entity) {
      entity = world.spawn(IsProjectile, NetId({ id }), Transform({ x: position.x, y: position.y, z: position.z }), Shot({ weapon: weapons.get(id) ?? 'ball' }));
      index.projectiles.set(id, entity);
    }
    // Shots fly straight: their heading is the way they moved since the last frame.
    const from = entity.get(Transform)!;
    const dx = position.x - from.x;
    const dy = position.y - from.y;
    const dz = position.z - from.z;
    const moved = Math.hypot(dx, dy, dz);
    if (moved > 1e-4) entity.set(Shot, (shot) => ({ ...shot, dx: dx / moved, dy: dy / moved, dz: dz / moved }));
    entity.set(Transform, { x: position.x, y: position.y, z: position.z, yaw: 0 });
  }
  for (const [id, entity] of index.projectiles) {
    if (!visible.has(id)) {
      entity.destroy();
      index.projectiles.delete(id);
    }
  }

  // Retire predicted throws when the server's projectile has ended (it hit someone, or was stopped), or they expire.
  const now = performance.now();
  const live = new Set(latest.projectiles.map((p) => p.id));
  world.query(PredictedProjectile).forEach((entity) => {
    const predicted = entity.get(PredictedProjectile)!;
    const ended = predicted.serverId !== '' && latest.tick > predicted.serverTick && !live.has(predicted.serverId);
    if (now >= predicted.expiresAt || ended) entity.destroy();
  });
}

/** Remove every mirrored and predicted entity, so a new match starts from an empty scene. */
export function clearWorld(world: World, index: EntityIndex): void {
  for (const entity of index.players.values()) entity.destroy();
  for (const entity of index.projectiles.values()) entity.destroy();
  index.players.clear();
  index.projectiles.clear();
  index.ownProjectiles.clear();
  world.query(PredictedProjectile).forEach((entity) => entity.destroy());
}

/** Advance locally predicted throws in a straight line, ending them where they meet a prop, the ground or the edge, as the server will. */
export function stepPredictedProjectiles(world: World, dtSeconds: number, arena: Arena): void {
  world.query(PredictedProjectile, Transform).forEach((entity) => {
    const predicted = entity.get(PredictedProjectile)!;
    const from = entity.get(Transform)!;
    const to = { x: from.x + predicted.vx * dtSeconds, y: from.y + predicted.vy * dtSeconds, z: from.z + predicted.vz * dtSeconds };
    if (Math.abs(to.x) > arena.halfWidth || Math.abs(to.z) > arena.halfDepth || flightBlocked(arena, from, to, predicted.radius)) {
      entity.destroy();
      return;
    }
    entity.set(Transform, { ...from, ...to });
  });
}
