import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from './config.js';
import { WEAPON_IDS, enabledWeapons, shotYaws, weaponRange, weaponStats } from './weapons.js';

describe('weapons', () => {
  it('reads the ball from the projectile settings', () => {
    expect(weaponStats(DEFAULT_GAME_CONFIG, 'ball')).toMatchObject({
      enabled: true,
      speed: DEFAULT_GAME_CONFIG.projectileSpeed,
      radius: DEFAULT_GAME_CONFIG.projectileRadius,
      cooldownMs: DEFAULT_GAME_CONFIG.projectileCooldownMs,
      pellets: 1,
    });
  });

  it('gives each weapon its own role: the rail reaches farthest, the scatter least, the blaster reloads fastest', () => {
    const range = (w: (typeof WEAPON_IDS)[number]) => weaponRange(weaponStats(DEFAULT_GAME_CONFIG, w));
    expect(range('rail')).toBeGreaterThan(range('ball'));
    expect(range('scatter')).toBeLessThan(range('blaster'));
    const reloads = WEAPON_IDS.map((w) => weaponStats(DEFAULT_GAME_CONFIG, w).cooldownMs);
    expect(Math.min(...reloads)).toBe(DEFAULT_GAME_CONFIG.blasterCooldownMs);
  });

  it('keeps the ball when every blaster is turned off', () => {
    const config = { ...DEFAULT_GAME_CONFIG, blasterEnabled: false, scatterEnabled: false, railEnabled: false };
    expect(enabledWeapons(config)).toEqual(['ball']);
    expect(enabledWeapons(DEFAULT_GAME_CONFIG)).toEqual([...WEAPON_IDS]);
  });

  it('fans a scatter shot evenly round the aim', () => {
    expect(shotYaws(1, { pellets: 1, spreadDeg: 30 })).toEqual([1]);
    const yaws = shotYaws(0, { pellets: 5, spreadDeg: 20 });
    expect(yaws).toHaveLength(5);
    expect(yaws[2]).toBeCloseTo(0);
    expect(yaws[4]! - yaws[0]!).toBeCloseTo((20 * Math.PI) / 180);
  });
});
