import { type Arena, type GameConfig, MAX_THROW_PITCH, type Vec3, directionFromAngles, groundHeight, raycastArena } from '@volleyland/game-core';

/**
 * First-person eye height above the feet: the height a throw leaves at. The crosshair line and the
 * ball's path are then one line, so a throw goes exactly where the crosshair points at any
 * distance, and cover that hides what you aim at also stops your throw (eyes higher than the hand
 * would see over cover the ball then hits).
 */
export const eyeHeight = (config: Pick<GameConfig, 'projectileHeight'>): number => config.projectileHeight;
/** Third person: an aim point this close is taken as level (a pitch from a point at your feet would be wild). */
const NEAR_AIM = 1.5;
/** Third-person throws tilt at most this much: the pointer picks a spot on the ground, not the sky. */
const THIRD_PERSON_MAX_PITCH = 0.7;

/**
 * The throw's direction from `position` (where the server will throw from). First person: towards
 * whatever the crosshair is on, as seen from the camera. The eye is at throw height, so standing
 * still that is just the view's direction; while moving, the camera (`seenFrom`: where the player
 * is drawn this frame) can trail the prediction by part of a step, and the throw still converges
 * on what the crosshair is on. Third person: towards the spot under the pointer, at hand height
 * above the ground there, so a throw at a player on a hill or in a dip still meets them.
 */
export function throwAngles(
  arena: Arena,
  config: GameConfig,
  position: Vec3,
  view: { firstPerson: boolean; yaw: number; pitch: number; aim: Vec3 | null; seenFrom?: Vec3 | null },
  targets: readonly Vec3[] = [],
  /** How far the shot flies (the weapon's range); the ball's by default. */
  range = config.projectileSpeed * (config.projectileLifetimeMs / 1000),
): { yaw: number; pitch: number } {
  const hand = { x: position.x, y: position.y + config.projectileHeight, z: position.z };
  if (view.firstPerson) {
    const seen = view.seenFrom ?? position;
    const eye = { x: seen.x, y: seen.y + eyeHeight(config), z: seen.z };
    const dir = directionFromAngles(view.yaw, view.pitch);
    const distance = Math.min(raycastArena(arena, eye, dir, range), rayToPlayers(eye, dir, targets, config, range));
    const target = { x: eye.x + dir.x * distance, y: eye.y + dir.y * distance, z: eye.z + dir.z * distance };
    const dx = target.x - hand.x;
    const dz = target.z - hand.z;
    const flat = Math.hypot(dx, dz);
    // Straight down or up at your own feet: keep the view's own angles.
    if (flat < 0.3) return { yaw: view.yaw, pitch: view.pitch };
    return { yaw: Math.atan2(dx, dz), pitch: clampPitch(Math.atan2(target.y - hand.y, flat), MAX_THROW_PITCH) };
  }
  if (!view.aim) return { yaw: view.yaw, pitch: 0 };
  const flat = Math.hypot(view.aim.x - position.x, view.aim.z - position.z);
  if (flat < NEAR_AIM) return { yaw: view.yaw, pitch: 0 };
  const rise = groundHeight(arena, view.aim.x, view.aim.z) - position.y;
  return { yaw: view.yaw, pitch: clampPitch(Math.atan2(rise, flat), THIRD_PERSON_MAX_PITCH) };
}

const clampPitch = (pitch: number, max: number) => Math.max(-max, Math.min(max, pitch));

/** Distance along a ray to the nearest other player's body (a vertical capsule), or `limit`. */
function rayToPlayers(origin: Vec3, dir: Vec3, players: readonly Vec3[], config: GameConfig, limit: number): number {
  let best = limit;
  const r = config.playerRadius;
  for (const p of players) {
    // Nearest approach of the ray to the body's vertical axis, on the floor plane.
    const ox = origin.x - p.x;
    const oz = origin.z - p.z;
    const a = dir.x * dir.x + dir.z * dir.z;
    if (a < 1e-9) continue;
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t <= 0 || t >= best) continue;
    const y = origin.y + dir.y * t;
    if (y >= p.y && y <= p.y + config.playerHeight) best = t;
  }
  return best;
}
