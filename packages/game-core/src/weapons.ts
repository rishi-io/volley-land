import type { GameConfig } from './config.js';

/**
 * What a player can fire. The ball is the original throw (the projectile settings); the others are
 * sci-fi blasters with their own speed, size, range and reload. A hit from any of them does the
 * same thing: it freezes the target until they answer. Weapons change how a hit is landed, never
 * what it costs.
 */
export const WEAPON_IDS = ['ball', 'blaster', 'scatter', 'rail'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export const DEFAULT_WEAPON: WeaponId = 'ball';

export interface WeaponStats {
  enabled: boolean;
  /** m/s */
  speed: number;
  /** Projectile radius, m. */
  radius: number;
  lifetimeMs: number;
  /** Minimum gap between two shots of this weapon by the same player. */
  cooldownMs: number;
  /** Projectiles per shot, fanned evenly across `spreadDeg`. */
  pellets: number;
  spreadDeg: number;
}

/** One weapon's stats, read from the flat game config. The ball is always enabled. */
export function weaponStats(config: GameConfig, weapon: WeaponId): WeaponStats {
  switch (weapon) {
    case 'ball':
      return {
        enabled: true,
        speed: config.projectileSpeed,
        radius: config.projectileRadius,
        lifetimeMs: config.projectileLifetimeMs,
        cooldownMs: config.projectileCooldownMs,
        pellets: 1,
        spreadDeg: 0,
      };
    case 'blaster':
      return {
        enabled: config.blasterEnabled,
        speed: config.blasterSpeed,
        radius: config.blasterRadius,
        lifetimeMs: config.blasterLifetimeMs,
        cooldownMs: config.blasterCooldownMs,
        pellets: 1,
        spreadDeg: 0,
      };
    case 'scatter':
      return {
        enabled: config.scatterEnabled,
        speed: config.scatterSpeed,
        radius: config.scatterRadius,
        lifetimeMs: config.scatterLifetimeMs,
        cooldownMs: config.scatterCooldownMs,
        pellets: config.scatterPellets,
        spreadDeg: config.scatterSpreadDeg,
      };
    case 'rail':
      return {
        enabled: config.railEnabled,
        speed: config.railSpeed,
        radius: config.railRadius,
        lifetimeMs: config.railLifetimeMs,
        cooldownMs: config.railCooldownMs,
        pellets: 1,
        spreadDeg: 0,
      };
  }
}

/** How far a weapon's shot flies before it vanishes, m. */
export const weaponRange = (stats: Pick<WeaponStats, 'speed' | 'lifetimeMs'>): number => stats.speed * (stats.lifetimeMs / 1000);

/** The weapons players may use in a match, in slot order (the ball always first). */
export const enabledWeapons = (config: GameConfig): WeaponId[] => WEAPON_IDS.filter((w) => weaponStats(config, w).enabled);

/** The yaw of each projectile in one shot: one straight ahead, or `pellets` fanned evenly across the spread. */
export function shotYaws(yaw: number, stats: Pick<WeaponStats, 'pellets' | 'spreadDeg'>): number[] {
  if (stats.pellets <= 1 || stats.spreadDeg <= 0) return [yaw];
  const spread = (stats.spreadDeg * Math.PI) / 180;
  return Array.from({ length: stats.pellets }, (_, i) => yaw - spread / 2 + (spread * i) / (stats.pellets - 1));
}
