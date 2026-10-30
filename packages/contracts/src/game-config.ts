import { z } from 'zod';

const positive = z.number().positive();
const ms = z.int().positive();

/** The server-controlled rules sent to clients on join (mirrors game-core's GameConfig). */
export const GameConfigSchema = z.strictObject({
  tickRate: positive,
  inputStepMs: ms,
  maxInputCredits: z.int().positive(),
  startingHealth: z.int().positive(),
  wrongAnswerDamage: z.int().positive(),
  answerTimeMs: ms,
  freezeMaxMs: ms,
  correctAnswerShieldMs: ms,
  respawnMs: ms,
  spawnProtectionMs: ms,
  playerSpeed: positive,
  playerRadius: positive,
  playerHeight: positive,
  maxSlopeDeg: z.number().min(5).max(85),
  projectileSpeed: positive,
  projectileRadius: positive,
  projectileLifetimeMs: ms,
  projectileCooldownMs: ms,
  projectileHeight: positive,
  weaponSwitchMs: z.int().nonnegative(),
  blasterEnabled: z.boolean(),
  blasterSpeed: positive,
  blasterRadius: positive,
  blasterLifetimeMs: ms,
  blasterCooldownMs: ms,
  scatterEnabled: z.boolean(),
  scatterSpeed: positive,
  scatterRadius: positive,
  scatterLifetimeMs: ms,
  scatterCooldownMs: ms,
  scatterPellets: z.int().min(1).max(12),
  scatterSpreadDeg: z.number().min(0).max(90),
  railEnabled: z.boolean(),
  railSpeed: positive,
  railRadius: positive,
  railLifetimeMs: ms,
  railCooldownMs: ms,
});

/** What a player can fire (mirrors game-core's WEAPON_IDS; a server test keeps them equal). */
export const WeaponIdSchema = z.enum(['ball', 'blaster', 'scatter', 'rail']);
export type WeaponIdDto = z.infer<typeof WeaponIdSchema>;

export type GameConfigDto = z.infer<typeof GameConfigSchema>;
