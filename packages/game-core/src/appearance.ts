/** Who gets a health bar over their head. Your own health is always in the HUD. */
export type HealthBarMode = 'off' | 'opponents' | 'everyone';

/**
 * How characters look. Presentation only: it never affects movement, hits or answers. The
 * server owns the live values (admin-managed) and sends them on join, like the game rules.
 */
export interface AppearanceSettings {
  /** Body colours, assigned to players by their look number (#rrggbb). */
  palette: string[];
  /** Hats and other head accessories, so players differ by shape as well as colour. */
  accessories: boolean;
  /** Bots wear a visor and antenna so everyone can tell them from people. */
  botMarker: boolean;
  /** A label over each character: "You", "Bot 2", "Player". */
  nameTags: boolean;
  healthBars: HealthBarMode;
  /** A soft shadow under each character (no real-time shadow maps). */
  blobShadows: boolean;
  /** Strength of run bob, lean, throw and hit animations, 0–1. Reduced-motion users always get 0. */
  animation: number;
}

/** Colour-blind-aware defaults that stay readable on the dark court floor. */
export const DEFAULT_PALETTE: readonly string[] = Object.freeze([
  '#56b4e9', // sky blue
  '#e69f00', // orange
  '#2ec4a0', // teal green
  '#f0e442', // yellow
  '#cc79a7', // pink
  '#ff7f50', // coral
  '#b8e986', // lime
  '#a0a8ff', // periwinkle
]);

export const DEFAULT_APPEARANCE: Readonly<AppearanceSettings> = Object.freeze({
  palette: [...DEFAULT_PALETTE],
  accessories: true,
  botMarker: true,
  nameTags: true,
  healthBars: 'opponents',
  blobShadows: true,
  animation: 1,
});

/** Human head accessories, picked by look number; bots wear the bot marker instead. */
export const ACCESSORIES = ['cap', 'beanie', 'headband', 'sprout', 'crown', 'horns'] as const;
export type Accessory = (typeof ACCESSORIES)[number];

/**
 * A player's colour and accessory from their look number. Looks are unique within a room; players
 * who share a colour (the palette wrapped around) get different accessories, so up to
 * palette × accessories players never share both.
 */
export function lookOf(look: number, palette: readonly string[]): { color: string; accessory: Accessory } {
  const colors = palette.length > 0 ? palette : DEFAULT_PALETTE;
  const color = colors[look % colors.length]!;
  // Same colour again (another round of the palette) → the next accessory along.
  const accessory = ACCESSORIES[((look % colors.length) + Math.floor(look / colors.length)) % ACCESSORIES.length]!;
  return { color, accessory };
}
