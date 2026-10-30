import { DEFAULT_GAME_CONFIG, arenaFromLayout, directionFromAngles, groundHeight, prop } from '@volleyland/game-core';
import type { WorldLayout } from '@volleyland/game-core';
import { describe, expect, it } from 'vitest';
import { eyeHeight, throwAngles } from './aim';

const config = DEFAULT_GAME_CONFIG;
const layout = (parts: Partial<WorldLayout>): WorldLayout => ({
  halfWidth: 30,
  halfDepth: 30,
  theme: 'park',
  floor: 'grass',
  scatter: 0,
  regions: [],
  props: [],
  spawnPoints: [
    { x: 0, z: -10 },
    { x: 0, z: 10 },
  ],
  ...parts,
});
const flat = arenaFromLayout(layout({}));

/** Where a throw with these angles, from the hand, passes at a given distance along the floor. */
const heightAt = (angles: { yaw: number; pitch: number }, from: { x: number; y: number; z: number }, flatDistance: number) => {
  const d = directionFromAngles(angles.yaw, angles.pitch);
  const t = flatDistance / Math.hypot(d.x, d.z);
  return from.y + config.projectileHeight + d.y * t;
};

describe('throwAngles', () => {
  it('third person on flat ground throws level towards the pointer', () => {
    expect(throwAngles(flat, config, { x: 0, y: 0, z: 0 }, { firstPerson: false, yaw: 0.3, pitch: 0, aim: { x: 5, y: 0, z: 5 } })).toEqual({ yaw: 0.3, pitch: 0 });
  });

  it('third person aims at hand height above the ground under the pointer, up or down hill', () => {
    const hilly = arenaFromLayout(layout({ hills: [{ x: 0, z: 10, width: 16, depth: 16, rotation: 0, height: 3, plateau: 0.5 }] }));
    const angles = throwAngles(hilly, config, { x: 0, y: 0, z: -2 }, { firstPerson: false, yaw: 0, pitch: 0, aim: { x: 0, y: 3, z: 10 } });
    expect(angles.pitch).toBeGreaterThan(0);
    expect(heightAt(angles, { x: 0, y: 0, z: -2 }, 12)).toBeCloseTo(groundHeight(hilly, 0, 10) + config.projectileHeight);
  });

  it('first person throws straight along the view: the eye is at throw height', () => {
    for (const pitch of [-0.4, 0, 0.3]) {
      const angles = throwAngles(flat, config, { x: 0, y: 0, z: 0 }, { firstPerson: true, yaw: 0.7, pitch, aim: null });
      expect(angles.yaw).toBeCloseTo(0.7, 6);
      expect(angles.pitch).toBeCloseTo(pitch, 6);
    }
  });

  it('first person throws from the hand to where the crosshair is', () => {
    // A wall 10 m ahead; looking level at it from eye height, the throw must rise from hand height to meet the same spot.
    const walled = arenaFromLayout(layout({ props: [prop('wall', 0, 10.3, { width: 10, depth: 0.6, height: 4 })] }));
    const angles = throwAngles(walled, config, { x: 0, y: 0, z: 0 }, { firstPerson: true, yaw: 0, pitch: 0, aim: null });
    expect(angles.yaw).toBeCloseTo(0);
    expect(heightAt(angles, { x: 0, y: 0, z: 0 }, 10)).toBeCloseTo(eyeHeight(config), 1);
  });

  it('first person aims at what the camera shows, even when the throw leaves from a little ahead of it', () => {
    // Strafing along +x: the camera (drawn) trails the predicted position by 0.2 m. Looking level along +z at a wall 10 m away.
    const walled = arenaFromLayout(layout({ props: [prop('wall', 0, 10.3, { width: 10, depth: 0.6, height: 4 })] }));
    const predicted = { x: 0.2, y: 0, z: 0 };
    const angles = throwAngles(walled, config, predicted, { firstPerson: true, yaw: 0, pitch: 0, aim: null, seenFrom: { x: 0, y: 0, z: 0 } });
    // Where the throw meets the wall's face (z = 10) is straight ahead of the camera: x = 0, not 0.2.
    const d = directionFromAngles(angles.yaw, angles.pitch);
    const t = 10 / d.z;
    expect(predicted.x + d.x * t).toBeCloseTo(0, 2);
    expect(config.projectileHeight + d.y * t).toBeCloseTo(eyeHeight(config), 2);
  });

  it('first person converges on a player in the crosshair before the ground behind them', () => {
    const target = { x: 0, y: 0, z: 6 };
    const angles = throwAngles(flat, config, { x: 0, y: 0, z: 0 }, { firstPerson: true, yaw: 0, pitch: -0.05, aim: null }, [target]);
    const eye = eyeHeight(config);
    const crosshairAt6 = eye + Math.tan(-0.05) * (6 - config.playerRadius);
    expect(heightAt(angles, { x: 0, y: 0, z: 0 }, 6 - config.playerRadius)).toBeCloseTo(crosshairAt6, 1);
  });
});
