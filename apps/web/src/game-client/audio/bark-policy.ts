import type { BarkEvent } from './audio-manifest';

/**
 * Decides which bot lines are spoken, so bots add character without chattering: each bot waits
 * between lines, lines never pile up, far bots stay quiet, and common moments speak only some of
 * the time. A windup is the exception: it warns of a sure shot, so it plays even straight after
 * another line, limited only so a bot that keeps restarting its windup does not repeat itself.
 */
export interface BarkRules {
  /** Least time between two lines from the same bot. */
  speakerCooldownMs: number;
  /** Least time between two windup warnings from the same bot (a windup restarts when its target slips away). */
  windupCooldownMs: number;
  /** Least time between any two lines. */
  globalGapMs: number;
  /** Most lines playing at once. */
  maxConcurrent: number;
  /** Bots further than this from the listener (m) say nothing. */
  audibleRange: number;
  /** Chance that a moment is voiced at all. */
  chance: Record<BarkEvent, number>;
}

export const DEFAULT_BARK_RULES: BarkRules = {
  speakerCooldownMs: 4000,
  windupCooldownMs: 3000,
  globalGapMs: 800,
  maxConcurrent: 2,
  audibleRange: 35,
  chance: { throw: 0.2, hit: 0.85, ouch: 0.7, windup: 1, respawn: 0.6 },
};

export class BarkPolicy {
  private readonly lastBySpeaker = new Map<string, number>();
  private readonly lastWindupBySpeaker = new Map<string, number>();
  private lastAny = -Infinity;
  private endsAt: number[] = [];
  private readonly lastTake = new Map<string, string>();

  constructor(
    private readonly rules: BarkRules = DEFAULT_BARK_RULES,
    private readonly random: () => number = Math.random,
  ) {}

  /** Whether a bot should say its line for this moment now; if so, records it as speaking until `endsAt`. */
  admit(speakerId: string, event: BarkEvent, distance: number, now: number): boolean {
    const { rules } = this;
    if (distance > rules.audibleRange) return false;
    this.endsAt = this.endsAt.filter((t) => t > now);
    if (this.endsAt.length >= rules.maxConcurrent) return false;
    if (event === 'windup') {
      if (now - (this.lastWindupBySpeaker.get(speakerId) ?? -Infinity) < rules.windupCooldownMs) return false;
      this.lastWindupBySpeaker.set(speakerId, now);
    } else {
      if (now - (this.lastBySpeaker.get(speakerId) ?? -Infinity) < rules.speakerCooldownMs) return false;
      if (now - this.lastAny < rules.globalGapMs) return false;
      if (this.random() >= rules.chance[event]) return false;
    }
    this.lastBySpeaker.set(speakerId, now);
    this.lastAny = now;
    return true;
  }

  /** Records how long an admitted line plays, so it counts against `maxConcurrent` until it ends. */
  speaking(now: number, durationMs: number): void {
    this.endsAt.push(now + durationMs);
  }

  /** A take of a line, avoiding the one this voice said last time for the same moment. */
  pickTake(voice: string, event: BarkEvent, takes: readonly string[]): string | undefined {
    const key = `${voice}:${event}`;
    const fresh = takes.length > 1 ? takes.filter((t) => t !== this.lastTake.get(key)) : takes;
    const take = fresh[Math.floor(this.random() * fresh.length)];
    if (take) this.lastTake.set(key, take);
    return take;
  }
}

/** The voice of a player, from its appearance slot (unique in the room), so bots sound different. */
export function voiceFor(look: number, voices: readonly string[]): string | undefined {
  return voices.length > 0 ? voices[look % voices.length] : undefined;
}
