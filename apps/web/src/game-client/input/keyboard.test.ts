import { describe, expect, it } from 'vitest';
import { moveFrom } from './keyboard';

describe('moveFrom', () => {
  it('matches the third-person camera at yaw 0: forward is +z, right is −x', () => {
    expect(moveFrom(1, 0, 0)).toEqual({ moveX: 0, moveZ: 1 });
    expect(moveFrom(0, 1, 0)).toEqual({ moveX: -1, moveZ: 0 });
  });

  it('turns with the first-person view', () => {
    const facingX = moveFrom(1, 0, Math.PI / 2);
    expect(facingX.moveX).toBeCloseTo(1);
    expect(facingX.moveZ).toBeCloseTo(0);
    const strafe = moveFrom(0, 1, Math.PI / 2);
    expect(strafe.moveZ).toBeCloseTo(1);
  });

  it('never sends an axis past ±1, even diagonally at an angle', () => {
    const diagonal = moveFrom(1, 1, Math.PI / 4);
    expect(Math.hypot(diagonal.moveX, diagonal.moveZ)).toBeCloseTo(1);
    expect(Math.abs(diagonal.moveX)).toBeLessThanOrEqual(1);
    expect(Math.abs(diagonal.moveZ)).toBeLessThanOrEqual(1);
  });
});
