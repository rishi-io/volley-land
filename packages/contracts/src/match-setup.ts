import { z } from 'zod';
import { GameConfigSchema } from './game-config.js';
import { AppearanceSettingsSchema, CameraSettingsSchema, SettingsSection } from './settings.js';
import { WorldLayoutSchema } from './world.js';

/**
 * Everything a client needs to play a match: the rules, the world, how characters are drawn and
 * how the game is seen.
 * Sent in the room.join ack, and again in match.setup whenever an admin change reaches the room.
 */
export const MatchSetupSchema = z.strictObject({
  config: GameConfigSchema,
  /** Both sides build the collision arena from this layout. */
  world: z.strictObject({ id: z.string(), name: z.string(), layout: WorldLayoutSchema }),
  /** Presentation only: never affects the simulation. */
  appearance: AppearanceSettingsSchema,
  /** Presentation only: first or third person, and whether players may switch. */
  camera: CameraSettingsSchema,
});

export type MatchSetup = z.infer<typeof MatchSetupSchema>;

const shownValue = z.union([z.number(), z.string(), z.boolean()]);

/**
 * One admin change, as players are told about it. `section` is a settings section, or `world` for
 * an edit to the world the room plays in. `from`/`to` are null when the value is not shown:
 * bot behaviour (never sent to clients), colour lists and world layouts.
 */
export const SettingChangeSchema = z.strictObject({
  section: z.union([SettingsSection, z.literal('world')]),
  key: z.string().min(1).max(64),
  from: shownValue.nullable(),
  to: shownValue.nullable(),
});

export type SettingChange = z.infer<typeof SettingChangeSchema>;
