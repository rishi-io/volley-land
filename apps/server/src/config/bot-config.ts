/**
 * How server-side bots behave. Bots are deliberately beatable: they aim with a random error,
 * react late and do not lead a moving target, so strafing dodges them. After a streak of misses
 * they wind up one "sure shot" that leads the target perfectly.
 *
 * Game clients never receive this; admins edit it as the bots settings section (its schema is
 * BotConfigSchema in @volleyland/contracts). Bots act only through the same Match commands
 * (move, throw, answer) that a human's commands go through.
 */
export interface BotConfig {
  /** Bots fill the room up to this many players in total; humans take their seats. 0 disables bots. */
  fillRoomTo: number;
  /** Bot speed as a fraction of playerSpeed. */
  moveSpeedFactor: number;
  /** How often a bot picks a new movement direction, [min, max] ms. */
  wanderChangeMs: [number, number];
  /** Bots try to stay between these distances from their target. */
  preferredRange: [number, number];

  /** Random error added to every normal throw, ± degrees. */
  aimErrorDeg: number;
  /** Bots aim at where the target was this long ago. */
  reactionMs: number;
  /** Whether normal throws lead a moving target (false: aim at its position, so strafing dodges). */
  leadTarget: boolean;
  /** Gap between shots, [min, max] ms (never faster than the weapon's reload). */
  fireIntervalMs: [number, number];
  /** Only shoot at targets closer than this, as a fraction of the weapon's full range. */
  maxRangeFactor: number;

  /** After this many misses in a row the next throw is a sure shot (no error, leads the target). 0 disables. */
  missesBeforeSureShot: number;
  /** A bot stands still this long before its sure shot, so the target can see it coming. */
  sureShotWindupMs: number;

  /** Chance a bot answers its question correctly when hit. */
  answerCorrectChance: number;
  /** How long a bot "thinks" before answering, [min, max] ms (capped by the question deadline). */
  answerDelayMs: [number, number];
}

const defaults: BotConfig = {
  fillRoomTo: 2,
  moveSpeedFactor: 0.7,
  wanderChangeMs: [800, 2000],
  preferredRange: [6, 14],

  aimErrorDeg: 20,
  reactionMs: 350,
  leadTarget: false,
  fireIntervalMs: [1200, 2200],
  maxRangeFactor: 0.8,

  missesBeforeSureShot: 4,
  sureShotWindupMs: 600,

  answerCorrectChance: 0.6,
  answerDelayMs: [2000, 6000],
};
export const DEFAULT_BOT_CONFIG: Readonly<BotConfig> = Object.freeze(defaults);
