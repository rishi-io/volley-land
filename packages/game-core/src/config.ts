/**
 * Game rules. The server owns the live values (it may override these defaults) and
 * hands them to clients on join; clients use them only for prediction and display.
 */
export interface GameConfig {
  /** Authoritative simulation rate (ticks per second). */
  tickRate: number;
  /** Duration covered by one client input command, in ms. */
  inputStepMs: number;
  /** Max buffered input credits per player: absorbs jitter without allowing speed-ups. */
  maxInputCredits: number;

  // Spec §5.2
  startingHealth: number;
  wrongAnswerDamage: number;
  answerTimeMs: number;
  freezeMaxMs: number;
  correctAnswerShieldMs: number;
  respawnMs: number;
  spawnProtectionMs: number;

  playerSpeed: number;
  playerRadius: number;
  playerHeight: number;
  /** The steepest ground a player can walk up, in degrees. Steeper slopes can only be walked down. */
  maxSlopeDeg: number;
  projectileSpeed: number;
  projectileRadius: number;
  projectileLifetimeMs: number;
  projectileCooldownMs: number;
  /** Height above the thrower's feet where projectiles spawn (they then fly straight, up or down as aimed). */
  projectileHeight: number;

  // Weapons (the ball above is weapon 1; see weapons.ts)
  /** After switching weapon, the new one cannot fire for this long. */
  weaponSwitchMs: number;
  blasterEnabled: boolean;
  blasterSpeed: number;
  blasterRadius: number;
  blasterLifetimeMs: number;
  blasterCooldownMs: number;
  scatterEnabled: boolean;
  scatterSpeed: number;
  scatterRadius: number;
  scatterLifetimeMs: number;
  scatterCooldownMs: number;
  /** Bolts per scatter shot, fanned evenly across scatterSpreadDeg. */
  scatterPellets: number;
  scatterSpreadDeg: number;
  railEnabled: boolean;
  railSpeed: number;
  railRadius: number;
  railLifetimeMs: number;
  railCooldownMs: number;
}

export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = Object.freeze({
  tickRate: 20,
  inputStepMs: 50,
  maxInputCredits: 4,

  startingHealth: 100,
  wrongAnswerDamage: 25,
  answerTimeMs: 10_000,
  freezeMaxMs: 10_000,
  correctAnswerShieldMs: 2_000,
  respawnMs: 4_000,
  spawnProtectionMs: 2_000,

  playerSpeed: 6,
  playerRadius: 0.5,
  playerHeight: 1.8,
  maxSlopeDeg: 40,
  projectileSpeed: 18,
  projectileRadius: 0.25,
  projectileLifetimeMs: 1_500,
  projectileCooldownMs: 500,
  projectileHeight: 1.2,

  weaponSwitchMs: 250,
  blasterEnabled: true,
  blasterSpeed: 32,
  blasterRadius: 0.12,
  blasterLifetimeMs: 650,
  blasterCooldownMs: 220,
  scatterEnabled: true,
  scatterSpeed: 24,
  scatterRadius: 0.14,
  scatterLifetimeMs: 450,
  scatterCooldownMs: 900,
  scatterPellets: 5,
  scatterSpreadDeg: 24,
  railEnabled: true,
  railSpeed: 70,
  railRadius: 0.1,
  railLifetimeMs: 700,
  railCooldownMs: 2_200,
});

export const tickIntervalMs = (config: Pick<GameConfig, 'tickRate'>): number => 1000 / config.tickRate;
