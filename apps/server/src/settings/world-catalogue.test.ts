import { CIRCLE_PROPS, PropKindSchema, SurfaceIdSchema, ThemeIdSchema, WORLD_LIMITS as CONTRACT_LIMITS, WeaponIdSchema } from '@volleyland/contracts';
import { PROPS, PROP_KINDS, SURFACES, THEMES, WEAPON_IDS, WORLD_LIMITS } from '@volleyland/game-core';
import { describe, expect, it } from 'vitest';

/** contracts mirrors game-core's world and weapon catalogues (it cannot import them); this keeps the two in step. */
describe('world catalogues', () => {
  it('lists the same themes, surfaces and prop kinds in contracts and game-core', () => {
    expect(ThemeIdSchema.options).toEqual([...THEMES]);
    expect(SurfaceIdSchema.options).toEqual([...SURFACES]);
    expect(PropKindSchema.options).toEqual([...PROP_KINDS]);
  });

  it('agrees on the world limits', () => {
    expect({ ...WORLD_LIMITS }).toEqual({ ...CONTRACT_LIMITS });
  });

  it('agrees on which props are round', () => {
    expect([...CIRCLE_PROPS].sort()).toEqual(PROP_KINDS.filter((k) => PROPS[k].shape === 'circle').sort());
  });

  it('lists the same weapons, in slot order', () => {
    expect(WeaponIdSchema.options).toEqual([...WEAPON_IDS]);
  });
});
