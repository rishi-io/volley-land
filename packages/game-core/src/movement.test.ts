import { describe, expect, it } from 'vitest';
import { createArena } from './arena.js';
import { boxCollider } from './colliders.js';
import { DEFAULT_GAME_CONFIG } from './config.js';
import { distance, vec3 } from './math.js';
import { stepMovement } from './movement.js';

const open = createArena({ halfWidth: 10, halfDepth: 10 });
const cfg = DEFAULT_GAME_CONFIG;

describe('stepMovement', () => {
  it('moves at most playerSpeed × dt, even for oversized input', () => {
    const next = stepMovement(vec3(), { moveX: 50, moveZ: 50 }, 0.05, cfg, open);
    expect(distance(vec3(), next)).toBeCloseTo(cfg.playerSpeed * 0.05);
  });

  it('ignores non-finite input', () => {
    expect(stepMovement(vec3(1, 0, 1), { moveX: Number.NaN, moveZ: Infinity }, 0.05, cfg, open)).toEqual(vec3(1, 0, 1));
  });

  it('keeps the player inside the arena bounds', () => {
    const next = stepMovement(vec3(9.4, 0, 0), { moveX: 1, moveZ: 0 }, 1, cfg, open);
    expect(next.x).toBe(10 - cfg.playerRadius);
  });

  it('pushes the player out of obstacles', () => {
    const arena = createArena({ halfWidth: 10, halfDepth: 10, colliders: [boxCollider(1.5, 0, 0.5, 1, 1)] });
    const next = stepMovement(vec3(0, 0, 0), { moveX: 1, moveZ: 0 }, 0.2, cfg, arena);
    expect(next.x).toBeCloseTo(1 - cfg.playerRadius);
  });

  it('is deterministic: the same inputs give the same position', () => {
    const inputs = Array.from({ length: 200 }, (_, i) => ({ moveX: Math.sin(i), moveZ: Math.cos(i * 0.7) }));
    const run = () => inputs.reduce((p, input) => stepMovement(p, input, 0.05, cfg, open), vec3());
    expect(run()).toEqual(run());
  });

  it('slides along a turned wall instead of stopping dead', () => {
    // A wall turned 45° (running from −x+z to +x−z) across the path: walking +x slides along it towards −z.
    const wall = createArena({ halfWidth: 10, halfDepth: 10, colliders: [boxCollider(2, 0, 3, 0.3, 2, Math.SQRT1_2, Math.SQRT1_2)] });
    let p = vec3(0, 0, -2);
    for (let i = 0; i < 20; i++) p = stepMovement(p, { moveX: 1, moveZ: 0 }, 0.05, cfg, wall);
    expect(p.z).toBeLessThan(-2.5);
    expect(p.x).toBeGreaterThan(0.5);
  });
});
