/** Plain-object vectors: cheap to serialize and identical on client and server. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const lengthSq = (a: Vec3): number => dot(a, a);
export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));
export const distanceSq = (a: Vec3, b: Vec3): number => lengthSq(sub(a, b));
export const distance = (a: Vec3, b: Vec3): number => Math.sqrt(distanceSq(a, b));

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});

/** Unit vector on the ground plane for a yaw angle (radians, 0 = +Z). */
export const directionFromYaw = (yaw: number): Vec3 => ({ x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });

/** Unit direction from a turn (yaw, 0 = +z) and a tilt up from level (pitch). */
export const directionFromAngles = (yaw: number, pitch: number): Vec3 => {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
};

/** The steepest a throw may be aimed up or down, in radians (about 70°). */
export const MAX_THROW_PITCH = 1.2;
