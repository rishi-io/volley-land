import type { WeaponId } from '@volleyland/game-core';
import { trait } from 'koota';

/** Server-assigned ID of a networked entity. */
export const NetId = trait({ id: '' });
/** Where the entity is drawn this frame (interpolated, or predicted for the local player); y is height above the flat floor level. */
export const Transform = trait({ x: 0, y: 0, z: 0, yaw: 0 });
export const Vitals = trait({ health: 100, status: 'alive' as 'alive' | 'frozen' | 'dead', protected: false });
export const IsPlayer = trait();
/** How a player is drawn: server-assigned appearance slot and whether it is a bot. */
export const Look = trait({ look: 0, bot: false });
/** performance.now() of the player's latest throw and hit, for character animation. */
export const Anim = trait({ throwAt: -1e9, hitAt: -1e9 });
/** The weapon a player holds (from snapshots; the local player's own choice for itself). */
export const Held = trait({ weapon: 'ball' as WeaponId });
export const IsLocal = trait();
export const IsProjectile = trait();
/** What fired a projectile and which way it flies (unit vector), so it can be drawn as that weapon's bolt. */
export const Shot = trait({ weapon: 'ball' as WeaponId, dx: 0, dy: 0, dz: 1 });
/**
 * Our own throw, drawn where it is now (the server's copy is drawn ~100 ms in the past, so it would
 * trail behind where the player aimed). `serverId`/`serverTick` link it to the server's projectile
 * once reported; it ends when that one does, or when it meets a prop or the ground here.
 */
export const PredictedProjectile = trait({ vx: 0, vy: 0, vz: 0, radius: 0.25, expiresAt: 0, serverId: '', serverTick: 0 });
