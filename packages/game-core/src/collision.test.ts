import { describe, expect, it } from 'vitest';
import {
  aabbIntersectsAabb,
  capsuleIntersectsCapsule,
  playerCapsule,
  segmentSegmentDistanceSq,
  sphereIntersectsAabb,
  sphereIntersectsCapsule,
  sphereIntersectsSphere,
} from './collision.js';
import { vec3 } from './math.js';

describe('collision primitives', () => {
  it('sphere vs sphere touches at the summed radius', () => {
    expect(sphereIntersectsSphere({ center: vec3(0, 0, 0), radius: 1 }, { center: vec3(2, 0, 0), radius: 1 })).toBe(true);
    expect(sphereIntersectsSphere({ center: vec3(0, 0, 0), radius: 1 }, { center: vec3(2.01, 0, 0), radius: 1 })).toBe(false);
  });

  it('sphere vs capsule uses the closest point on the segment', () => {
    const capsule = { a: vec3(0, 0, 0), b: vec3(0, 2, 0), radius: 0.5 };
    expect(sphereIntersectsCapsule({ center: vec3(0.7, 1, 0), radius: 0.25 }, capsule)).toBe(true);
    expect(sphereIntersectsCapsule({ center: vec3(0.8, 1, 0), radius: 0.25 }, capsule)).toBe(false);
    expect(sphereIntersectsCapsule({ center: vec3(0, 2.7, 0), radius: 0.25 }, capsule)).toBe(true);
  });

  it('segment distance handles crossing, parallel and degenerate segments', () => {
    expect(segmentSegmentDistanceSq(vec3(-1, 0, 0), vec3(1, 0, 0), vec3(0, 1, -1), vec3(0, 1, 1))).toBeCloseTo(1);
    expect(segmentSegmentDistanceSq(vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 2, 0), vec3(1, 2, 0))).toBeCloseTo(4);
    expect(segmentSegmentDistanceSq(vec3(0, 0, 0), vec3(0, 0, 0), vec3(3, 4, 0), vec3(3, 4, 0))).toBeCloseTo(25);
  });

  it('a fast projectile swept over one tick still hits a player it passes through', () => {
    const player = playerCapsule(vec3(0, 0, 0), 0.5, 1.8);
    // Starts and ends outside the player, but the swept path crosses it.
    const swept = { a: vec3(-2, 1.2, 0), b: vec3(2, 1.2, 0), radius: 0.25 };
    expect(sphereIntersectsCapsule({ center: swept.a, radius: 0.25 }, player)).toBe(false);
    expect(sphereIntersectsCapsule({ center: swept.b, radius: 0.25 }, player)).toBe(false);
    expect(capsuleIntersectsCapsule(swept, player)).toBe(true);
  });

  it('sphere vs AABB and AABB vs AABB', () => {
    const box = { min: vec3(0, 0, 0), max: vec3(1, 1, 1) };
    expect(sphereIntersectsAabb({ center: vec3(1.2, 0.5, 0.5), radius: 0.25 }, box)).toBe(true);
    expect(sphereIntersectsAabb({ center: vec3(1.3, 0.5, 0.5), radius: 0.25 }, box)).toBe(false);
    expect(aabbIntersectsAabb(box, { min: vec3(1, 1, 1), max: vec3(2, 2, 2) })).toBe(true);
    expect(aabbIntersectsAabb(box, { min: vec3(1.1, 0, 0), max: vec3(2, 1, 1) })).toBe(false);
  });
});
