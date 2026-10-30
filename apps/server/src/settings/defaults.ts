import { ALL_QUESTIONS, type SectionValues, SECTION_SCHEMAS, type SettingsSection, WorldSchema } from '@volleyland/contracts';
import { BUILTIN_WORLDS, DEFAULT_APPEARANCE, DEFAULT_CAMERA, DEFAULT_GAME_CONFIG, DEFAULT_WORLD_ID, type GameConfig, type World } from '@volleyland/game-core';
import { DEFAULT_BOT_CONFIG } from '../config/bot-config.js';

type GameRuleSections = Pick<SectionValues, 'simulation' | 'combat' | 'movement' | 'projectiles' | 'weapons'>;

/** The game-rule sections merged into the flat GameConfig that matches and clients use. */
export const gameConfigFrom = (s: GameRuleSections): GameConfig => ({ ...s.simulation, ...s.combat, ...s.movement, ...s.projectiles, ...s.weapons });

export function splitGameConfig(config: GameConfig): GameRuleSections {
  return {
    simulation: { tickRate: config.tickRate, inputStepMs: config.inputStepMs, maxInputCredits: config.maxInputCredits },
    combat: {
      startingHealth: config.startingHealth,
      wrongAnswerDamage: config.wrongAnswerDamage,
      answerTimeMs: config.answerTimeMs,
      freezeMaxMs: config.freezeMaxMs,
      correctAnswerShieldMs: config.correctAnswerShieldMs,
      respawnMs: config.respawnMs,
      spawnProtectionMs: config.spawnProtectionMs,
    },
    movement: { playerSpeed: config.playerSpeed, playerRadius: config.playerRadius, playerHeight: config.playerHeight, maxSlopeDeg: config.maxSlopeDeg },
    projectiles: {
      projectileSpeed: config.projectileSpeed,
      projectileRadius: config.projectileRadius,
      projectileLifetimeMs: config.projectileLifetimeMs,
      projectileCooldownMs: config.projectileCooldownMs,
      projectileHeight: config.projectileHeight,
    },
    weapons: {
      weaponSwitchMs: config.weaponSwitchMs,
      blasterEnabled: config.blasterEnabled,
      blasterSpeed: config.blasterSpeed,
      blasterRadius: config.blasterRadius,
      blasterLifetimeMs: config.blasterLifetimeMs,
      blasterCooldownMs: config.blasterCooldownMs,
      scatterEnabled: config.scatterEnabled,
      scatterSpeed: config.scatterSpeed,
      scatterRadius: config.scatterRadius,
      scatterLifetimeMs: config.scatterLifetimeMs,
      scatterCooldownMs: config.scatterCooldownMs,
      scatterPellets: config.scatterPellets,
      scatterSpreadDeg: config.scatterSpreadDeg,
      railEnabled: config.railEnabled,
      railSpeed: config.railSpeed,
      railRadius: config.railRadius,
      railLifetimeMs: config.railLifetimeMs,
      railCooldownMs: config.railCooldownMs,
    },
  };
}

/** The built-in defaults: what a fresh store is seeded with and what "reset to defaults" restores. */
export const DEFAULT_SECTIONS: Readonly<SectionValues> = Object.freeze({
  ...splitGameConfig(DEFAULT_GAME_CONFIG),
  rooms: { maxPlayers: 4, worldId: DEFAULT_WORLD_ID },
  // Every published question, from every curriculum, level and subject (for worlds without their own pool).
  questions: structuredClone(ALL_QUESTIONS) as SectionValues['questions'],
  bots: DEFAULT_BOT_CONFIG,
  appearance: { ...DEFAULT_APPEARANCE, palette: [...DEFAULT_APPEARANCE.palette] },
  camera: { ...DEFAULT_CAMERA },
});

/** What an empty settings store is initialised with (tests override it with their own rules). */
export const SETTINGS_SEED = Symbol('SETTINGS_SEED');

export interface SettingsSeed {
  sections: SectionValues;
  worlds: readonly World[];
}

export const DEFAULT_SEED: SettingsSeed = { sections: DEFAULT_SECTIONS, worlds: BUILTIN_WORLDS };

/** Build a seed from defaults plus overrides, validated like an admin write (for tests and fixtures). */
export function seedWith(overrides: { game?: Partial<GameConfig>; sections?: Partial<SectionValues>; worlds?: readonly World[] } = {}): SettingsSeed {
  const worlds = overrides.worlds ?? DEFAULT_SEED.worlds;
  const sections: SectionValues = {
    ...DEFAULT_SECTIONS,
    ...splitGameConfig({ ...DEFAULT_GAME_CONFIG, ...overrides.game }),
    rooms: { ...DEFAULT_SECTIONS.rooms, worldId: worlds[0]!.id },
    ...overrides.sections,
  };
  for (const name of Object.keys(SECTION_SCHEMAS) as SettingsSection[]) SECTION_SCHEMAS[name].parse(sections[name]);
  for (const world of worlds) WorldSchema.parse(world);
  return { sections, worlds };
}
