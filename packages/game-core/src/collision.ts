import { type Vec3, add, clamp, dot, distanceSq, lengthSq, scale, sub } from './math.js';

export interface Sphere {
  center: Vec3;
  radius: number;
}

/** A segment swept by a radius: players, and projectiles swept over one tick. */
export interface Capsule {
  a: Vec3;
  b: Vec3;
  radius: number;
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export function closestPointOnSegment(point: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const abLenSq = lengthSq(ab);
  if (abLenSq === 0) return a;
  const t = clamp(dot(sub(point, a), ab) / abLenSq, 0, 1);
  return add(a, scale(ab, t));
}

export function closestPointOnAabb(point: Vec3, box: Aabb): Vec3 {
  return {
    x: clamp(point.x, box.min.x, box.max.x),
    y: clamp(point.y, box.min.y, box.max.y),
    z: clamp(point.z, box.min.z, box.max.z),
  };
}

/** Squared distance between the closest points of segments p1→q1 and p2→q2 (Ericson, RTCD §5.1.9). */
export function segmentSegmentDistanceSq(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = lengthSq(d1);
  const e = lengthSq(d2);
  const f = dot(d2, r);
  const epsilon = 1e-12;
  let s: number;
  let t: number;

  if (a <= epsilon && e <= epsilon) return lengthSq(r);
  if (a <= epsilon) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e <= epsilon) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  return distanceSq(add(p1, scale(d1, s)), add(p2, scale(d2, t)));
}

export function sphereIntersectsSphere(s1: Sphere, s2: Sphere): boolean {
  const r = s1.radius + s2.radius;
  return distanceSq(s1.center, s2.center) <= r * r;
}

export function sphereIntersectsCapsule(sphere: Sphere, capsule: Capsule): boolean {
  const closest = closestPointOnSegment(sphere.center, capsule.a, capsule.b);
  const r = sphere.radius + capsule.radius;
  return distanceSq(sphere.center, closest) <= r * r;
}

export function capsuleIntersectsCapsule(c1: Capsule, c2: Capsule): boolean {
  const r = c1.radius + c2.radius;
  return segmentSegmentDistanceSq(c1.a, c1.b, c2.a, c2.b) <= r * r;
}

export function sphereIntersectsAabb(sphere: Sphere, box: Aabb): boolean {
  return distanceSq(sphere.center, closestPointOnAabb(sphere.center, box)) <= sphere.radius * sphere.radius;
}

export function aabbIntersectsAabb(a: Aabb, b: Aabb): boolean {
  return (
    a.min.x <= b.max.x &&
    a.max.x >= b.min.x &&
    a.min.y <= b.max.y &&
    a.max.y >= b.min.y &&
    a.min.z <= b.max.z &&
    a.max.z >= b.min.z
  );
}

/** Vertical player capsule standing on the ground at `position`. */
export function playerCapsule(position: Vec3, radius: number, height: number): Capsule {
  return {
    a: { x: position.x, y: position.y + radius, z: position.z },
    b: { x: position.x, y: position.y + Math.max(height - radius, radius), z: position.z },
    radius,
  };
}
