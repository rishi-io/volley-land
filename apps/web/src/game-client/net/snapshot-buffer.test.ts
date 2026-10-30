import { PROTOCOL_VERSION, type StateSnapshot } from '@volleyland/contracts';
import { describe, expect, it } from 'vitest';
import { ServerClock, SnapshotBuffer } from './snapshot-buffer.js';

const snap = (tick: number, x: number): StateSnapshot => ({
  v: PROTOCOL_VERSION,
  matchId: 'm',
  msgId: crypto.randomUUID(),
  serverTime: tick * 50,
  tick,
  players: [{ id: 'p', x, z: 0, yaw: 0, health: 100, status: 'alive', protected: false, lastInputSeq: -1, bot: false, look: 0, weapon: 'ball' }],
  projectiles: [],
});

describe('SnapshotBuffer', () => {
  it('interpolates between the two snapshots around the render time', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snap(1, 0));
    buffer.push(snap(2, 10));
    const sample = buffer.sample(75);
    expect(sample.players.get('p')!.x).toBeCloseTo(5);
    expect(sample.starved).toBe(false);
  });

  it('holds the newest state and reports starvation past the newest snapshot', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snap(1, 0));
    buffer.push(snap(2, 10));
    const sample = buffer.sample(500);
    expect(sample.players.get('p')!.x).toBe(10);
    expect(sample.starved).toBe(true);
  });

  it('ignores out-of-order snapshots', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(snap(2, 10));
    buffer.push(snap(1, 0));
    expect(buffer.latest!.tick).toBe(2);
  });
});

describe('ServerClock', () => {
  it('keeps the least-delayed offset sample', () => {
    const clock = new ServerClock();
    clock.observe(1_000, 100); // offset 900
    clock.observe(1_100, 150); // offset 950 (less delayed)
    expect(clock.now(200)).toBe(1_150);
  });
});
