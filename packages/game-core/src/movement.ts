import { type Arena, collidersAround, groundHeight } from './arena.js';
import { pushCircleOut } from './colliders.js';
import type { GameConfig } from './config.js';
import { type Vec3, clamp } from './math.js';
import { climbLimit } from './terrain.js';

export interface MoveInput {
  /** Desired direction on X/Z; magnitudes above 1 are normalized, so input cannot exceed max speed. */
  moveX: number;
  moveZ: number;
}

type MovementConfig = Pick<GameConfig, 'playerSpeed' | 'playerRadius' | 'maxSlopeDeg'>;

/**
 * Advance a player by one input step. Shared verbatim by client prediction and server
 * validation, so both sides land on the same position for the same inputs. On rolling ground the
 * player follows the ground (y is the ground height), and a step that climbs steeper than
 * `maxSlopeDeg` slides along the slope instead, or stops.
 */
export function stepMovement(position: Vec3, input: MoveInput, dtSeconds: number, config: MovementConfig, arena: Arena): Vec3 {
  let dx = Number.isFinite(input.moveX) ? input.moveX : 0;
  let dz = Number.isFinite(input.moveZ) ? input.moveZ : 0;
  const len = Math.hypot(dx, dz);
  if (len > 1) {
    dx /= len;
    dz /= len;
  }
  const step = config.playerSpeed * dtSeconds;
  const r = config.playerRadius;
  const near = collidersAround(arena, position.x + dx * step, position.z + dz * step, r + step + 0.01);
  const settle = (tx: number, tz: number) => {
    let x = clamp(tx, -arena.halfWidth + r, arena.halfWidth - r);
    let z = clamp(tz, -arena.halfDepth + r, arena.halfDepth - r);
    // Push the player's footprint circle out of nearby props. A second pass settles corners where
    // leaving one prop pushed it into another.
    for (let pass = 0; pass < 2; pass++) {
      for (const collider of near) {
        const out = pushCircleOut(collider, x, z, r);
        if (!out) continue;
        x = clamp(out.x, -arena.halfWidth + r, arena.halfWidth - r);
        z = clamp(out.z, -arena.halfDepth + r, arena.halfDepth - r);
      }
    }
    return { x, z };
  };

  let next = settle(position.x + dx * step, position.z + dz * step);
  if (!arena.ground) return { x: next.x, y: position.y, z: next.z };

  const limit = climbLimit(config.maxSlopeDeg);
  const from = groundHeight(arena, position.x, position.z);
  const tooSteep = (p: { x: number; z: number }) => {
    const run = Math.hypot(p.x - position.x, p.z - position.z);
    return run > 1e-9 && groundHeight(arena, p.x, p.z) - from > limit * run;
  };
  if (tooSteep(next)) {
    // Slide along the slope: keep whichever part of the step (along x or along z) can be climbed.
    const slides = [settle(position.x + dx * step, position.z), settle(position.x, position.z + dz * step)]
      .filter((p) => !tooSteep(p))
      .sort((a, b) => Math.hypot(b.x - position.x, b.z - position.z) - Math.hypot(a.x - position.x, a.z - position.z));
    next = slides[0] ?? { x: position.x, z: position.z };
  }
  return { x: next.x, y: groundHeight(arena, next.x, next.z), z: next.z };
}
