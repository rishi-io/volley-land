import { describe, expect, it } from 'vitest';
import { BarkPolicy, type BarkRules, DEFAULT_BARK_RULES, voiceFor } from './bark-policy';

const always: BarkRules = { ...DEFAULT_BARK_RULES, chance: { throw: 1, hit: 1, ouch: 1, windup: 1, respawn: 1 } };

describe('BarkPolicy', () => {
  it('makes each bot wait between lines and keeps a gap between any two', () => {
    const policy = new BarkPolicy(always);
    expect(policy.admit('b1', 'hit', 5, 0)).toBe(true);
    expect(policy.admit('b1', 'ouch', 5, 2000)).toBe(false);
    expect(policy.admit('b2', 'ouch', 5, 300)).toBe(false);
    expect(policy.admit('b2', 'ouch', 5, 900)).toBe(true);
    expect(policy.admit('b1', 'ouch', 5, 4100)).toBe(true);
  });

  it('keeps far bots quiet', () => {
    expect(new BarkPolicy(always).admit('b1', 'hit', 50, 0)).toBe(false);
  });

  it('never lets more lines than the limit play at once', () => {
    const policy = new BarkPolicy({ ...always, globalGapMs: 0, maxConcurrent: 2 });
    for (const [bot, at] of [['b1', 0], ['b2', 10]] as const) {
      expect(policy.admit(bot, 'hit', 5, at)).toBe(true);
      policy.speaking(at, 1500);
    }
    expect(policy.admit('b3', 'hit', 5, 20)).toBe(false);
    expect(policy.admit('b3', 'hit', 5, 1600)).toBe(true);
  });

  it('voices common moments only some of the time', () => {
    const policy = new BarkPolicy(DEFAULT_BARK_RULES, () => 0.5);
    expect(policy.admit('b1', 'throw', 5, 0)).toBe(false);
    expect(policy.admit('b1', 'hit', 5, 0)).toBe(true);
  });

  it('always warns of a sure shot, even straight after another line, but does not repeat the warning', () => {
    const policy = new BarkPolicy(DEFAULT_BARK_RULES, () => 0);
    expect(policy.admit('b1', 'hit', 5, 0)).toBe(true);
    expect(policy.admit('b1', 'windup', 5, 100)).toBe(true);
    expect(policy.admit('b1', 'windup', 5, 400)).toBe(false);
    expect(policy.admit('b1', 'windup', 5, 3200)).toBe(true);
  });

  it('does not repeat the take a voice said last time', () => {
    const policy = new BarkPolicy(always, () => 0);
    const takes = ['a.mp3', 'b.mp3'];
    expect(policy.pickTake('cowboy', 'hit', takes)).toBe('a.mp3');
    expect(policy.pickTake('cowboy', 'hit', takes)).toBe('b.mp3');
    expect(policy.pickTake('cowboy', 'hit', takes)).toBe('a.mp3');
    expect(policy.pickTake('cowboy', 'respawn', ['only.mp3'])).toBe('only.mp3');
    expect(policy.pickTake('cowboy', 'respawn', ['only.mp3'])).toBe('only.mp3');
  });
});

describe('voiceFor', () => {
  it('gives players in different appearance slots different voices', () => {
    const voices = ['cowboy', 'hero', 'sassy', 'sunny'];
    expect(new Set([0, 1, 2, 3].map((look) => voiceFor(look, voices))).size).toBe(4);
    expect(voiceFor(4, voices)).toBe('cowboy');
    expect(voiceFor(0, [])).toBeUndefined();
  });
});
