import { BotConfigSchema } from '@volleyland/contracts';
import { describe, expect, it } from 'vitest';
import { type BotConfig, DEFAULT_BOT_CONFIG } from './bot-config.js';

describe('DEFAULT_BOT_CONFIG', () => {
  it('passes the admin schema and fills a room to two players with beatable bots', () => {
    const parsed: BotConfig = BotConfigSchema.parse(DEFAULT_BOT_CONFIG); // typed: interface and schema must agree
    expect(parsed).toMatchObject({ fillRoomTo: 2, leadTarget: false });
  });

  it('rejects bad values and unknown keys', () => {
    expect(BotConfigSchema.safeParse({ ...DEFAULT_BOT_CONFIG, answerCorrectChance: 1.5 }).success).toBe(false);
    expect(BotConfigSchema.safeParse({ ...DEFAULT_BOT_CONFIG, fireIntervalMs: [900, 500] }).success).toBe(false);
    expect(BotConfigSchema.safeParse({ ...DEFAULT_BOT_CONFIG, aimbot: true }).success).toBe(false);
  });
});
