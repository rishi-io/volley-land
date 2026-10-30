import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG, tickIntervalMs } from './config.js';

describe('DEFAULT_GAME_CONFIG', () => {
  it('matches the spec §5.2 rules', () => {
    expect(DEFAULT_GAME_CONFIG).toMatchObject({
      startingHealth: 100,
      wrongAnswerDamage: 25,
      answerTimeMs: 10_000,
      freezeMaxMs: 10_000,
      correctAnswerShieldMs: 2_000,
      respawnMs: 4_000,
      spawnProtectionMs: 2_000,
    });
  });

  it('runs the simulation at ~20 ticks/s', () => {
    expect(tickIntervalMs(DEFAULT_GAME_CONFIG)).toBe(50);
  });

  it('is frozen so no caller can mutate the defaults', () => {
    expect(Object.isFrozen(DEFAULT_GAME_CONFIG)).toBe(true);
  });
});
