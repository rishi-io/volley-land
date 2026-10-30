/** What a bot says, by the game moment that plays it. Matches BarkEvent in scripts/audio/recipes.ts. */
export type BarkEvent = 'throw' | 'hit' | 'ouch' | 'windup' | 'respawn';

/** Every generated sound that exists, as URLs under /audio (see manifest.ts, generated). */
export interface AudioManifest {
  /** Sound effect ID → URL. */
  sfx: Record<string, string>;
  /** Voice persona → the takes of each line it has. */
  voices: Record<string, Partial<Record<BarkEvent, string[]>>>;
  /** World theme → looping music track. */
  music: Record<string, string>;
}
