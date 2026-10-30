import { describe, expect, it } from 'vitest';
import { type CharacterFrame, newMotionState, stepPose } from './motion';

const frame = (over: Partial<CharacterFrame> = {}): CharacterFrame => ({
  x: 0, y: 0, z: 0, yaw: 0, status: 'alive', protected: false, health: 100, throwAt: -1e9, hitAt: -1e9, ...over,
});

/** Run `frames` steps of 16 ms, moving at `vx`,`vz` m/s, and return the last pose. */
function run(frames: number, strength: number, vx = 0, vz = 0, over: Partial<CharacterFrame> = {}, start = 1000) {
  const m = newMotionState();
  let pose = stepPose(m, frame(over), 0.016, start, strength, 6);
  for (let i = 1; i <= frames; i++) pose = stepPose(m, frame({ ...over, x: vx * 0.016 * i, z: vz * 0.016 * i }), 0.016, start + 16 * i, strength, 6);
  return pose;
}

describe('stepPose', () => {
  it('bobs and leans forward when running forward, and stays upright when still', () => {
    const running = run(40, 1, 0, 6);
    expect(running.leanX).toBeGreaterThan(0.1);
    expect(Math.abs(running.leanZ)).toBeLessThan(0.02);
    const still = run(40, 1);
    expect(still.bob).toBe(0);
    expect(still.leanX).toBe(0);
  });

  it('leans sideways when strafing', () => {
    expect(Math.abs(run(40, 1, 6, 0).leanZ)).toBeGreaterThan(0.1);
  });

  it('does not move at all with strength 0, but still flashes on a hit', () => {
    const pose = run(40, 0, 0, 6, { hitAt: 1000 + 16 * 40 - 50 });
    expect([pose.bob, pose.leanX, pose.leanZ, pose.lunge]).toEqual([0, 0, 0, 0]);
    expect(pose.scaleY).toBe(1);
    expect(pose.flash).toBeGreaterThan(0.5);
  });

  it('lunges right after a throw and settles after', () => {
    expect(run(10, 1, 0, 0, { throwAt: 1000 + 160 - 120 }).lunge).toBeGreaterThan(0.2);
    expect(run(30, 1, 0, 0, { throwAt: 1000 }).lunge).toBe(0);
  });

  it('frosts over while frozen and shrinks away when knocked out', () => {
    expect(run(60, 1, 0, 0, { status: 'frozen' }).frost).toBeGreaterThan(0.9);
    const m = newMotionState();
    stepPose(m, frame(), 0.016, 1000, 1, 6);
    expect(stepPose(m, frame({ status: 'dead' }), 0.016, 1016, 1, 6).visible).toBe(true);
    expect(stepPose(m, frame({ status: 'dead' }), 0.016, 1400, 1, 6).visible).toBe(false);
  });
});
