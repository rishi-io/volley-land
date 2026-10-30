/*
 * How every generated sound is made: the prompt, voice and settings for each file under
 * apps/web/public/audio/. `yarn audio:generate` turns these into files and writes the client's
 * manifest; change a recipe and the next run regenerates just that file.
 */

/** A bot voice: a voice from the ElevenLabs Voice Library (`yarn audio:samples` to browse). */
export interface VoiceRecipe {
  /** Persona ID, also the folder name under audio/voices/. */
  id: string;
  /** Name in the ElevenLabs account. */
  name: string;
  /** The library voice and its owner (from the shared-voices listing). */
  library: { voiceId: string; ownerId: string };
}

/** What a bot says, by the game moment that plays it. Must match BarkEvent in the web client. */
export type BarkEvent = 'throw' | 'hit' | 'ouch' | 'windup' | 'respawn';

export interface LineRecipe {
  voice: string;
  event: BarkEvent;
  /**
   * eleven_v3 text; [tags] steer delivery and are not spoken. Keep lines to about a second; a
   * windup must fit the bot's stand-still before a sure shot (sureShotWindupMs, 600 ms by default).
   */
  text: string;
  seed: number;
}

export interface SfxRecipe {
  id: string;
  prompt: string;
  /** 0.5–30 s; omit to let the model choose. */
  seconds?: number;
  loop?: boolean;
  /** 0–1: how literally to follow the prompt. */
  influence?: number;
}

export interface MusicRecipe {
  /** One track per world theme (THEMES in game-core). */
  theme: string;
  prompt: string;
  lengthMs: number;
}

export const VOICES: VoiceRecipe[] = [
  {
    id: 'sunny',
    name: 'Volleyland Sunny (Aerisita)',
    library: { voiceId: 'vGQNBgLaiM3EdZtxIiuY', ownerId: '948c73cac3f86eb1c498e46ddaa022cf5e8db7f241909b509c34ace490635d76' },
  },
  {
    id: 'cowboy',
    name: 'Volleyland Cowboy (Sand White Cowboy)',
    library: { voiceId: 'yqZhXcy5spYR7Hhv17QY', ownerId: 'b2d1995dfac087f57f4d7e9da6f8f3a70854fa8d7aac94c4be22cda33e9ed4ef' },
  },
  {
    id: 'sassy',
    name: 'Volleyland Sassy (Cassie)',
    library: { voiceId: 'qqKpdUwkD3h8VyDLKQyz', ownerId: 'c753fdec9e85942ffd951f20eff5d464078b4c5260aab985b51437611dc29fc2' },
  },
  {
    id: 'hero',
    name: 'Volleyland Hero (Steven Casteel)',
    library: { voiceId: 'QEj0heL4nQHjaGrihlr0', ownerId: '531b5f847f3a6e4463254c5da9007929283efab697b459a38dfb82984d1315c1' },
  },
];

export const LINES: LineRecipe[] = [
  { voice: 'sunny', event: 'throw', text: '[excited] Heads up!', seed: 1 },
  { voice: 'sunny', event: 'hit', text: '[giggles] Gotcha!', seed: 1 },
  { voice: 'sunny', event: 'hit', text: "[cheerfully] Tag, you're it!", seed: 1 },
  { voice: 'sunny', event: 'ouch', text: '[surprised] Ow!', seed: 1 },
  { voice: 'sunny', event: 'ouch', text: '[annoyed] Hey, no fair!', seed: 1 },
  { voice: 'sunny', event: 'windup', text: '[playfully] Freeze!', seed: 1 },
  { voice: 'sunny', event: 'respawn', text: "[cheerfully] I'm back!", seed: 1 },

  { voice: 'cowboy', event: 'throw', text: 'Yee-haw!', seed: 1 },
  { voice: 'cowboy', event: 'hit', text: 'Gotcha, partner!', seed: 1 },
  { voice: 'cowboy', event: 'hit', text: '[proudly] Bullseye!', seed: 1 },
  { voice: 'cowboy', event: 'ouch', text: '[surprised] Whoa there!', seed: 1 },
  { voice: 'cowboy', event: 'ouch', text: '[annoyed] Ow, my hat!', seed: 1 },
  { voice: 'cowboy', event: 'windup', text: 'Hold it!', seed: 1 },
  { voice: 'cowboy', event: 'respawn', text: '[cheerfully] Back in the saddle.', seed: 1 },

  { voice: 'sassy', event: 'throw', text: '[sassy] Catch!', seed: 1 },
  { voice: 'sassy', event: 'hit', text: '[sassy] Gotcha, sugar!', seed: 1 },
  { voice: 'sassy', event: 'hit', text: '[sassy] Too slow!', seed: 1 },
  { voice: 'sassy', event: 'ouch', text: '[annoyed] Ow! Rude!', seed: 1 },
  { voice: 'sassy', event: 'ouch', text: '[annoyed] Excuse me!', seed: 1 },
  { voice: 'sassy', event: 'windup', text: "[sassy] Don't move!", seed: 1 },
  { voice: 'sassy', event: 'respawn', text: '[sassy] Miss me?', seed: 1 },

  { voice: 'hero', event: 'throw', text: '[shouts] For glory!', seed: 1 },
  { voice: 'hero', event: 'hit', text: '[triumphant] Gotcha!', seed: 1 },
  { voice: 'hero', event: 'hit', text: '[proudly] Victory!', seed: 1 },
  { voice: 'hero', event: 'ouch', text: '[dramatically] Nooo!', seed: 1 },
  { voice: 'hero', event: 'ouch', text: '[surprised] Argh!', seed: 1 },
  { voice: 'hero', event: 'windup', text: 'Steady!', seed: 1 },
  { voice: 'hero', event: 'respawn', text: '[proudly] I have returned!', seed: 1 },
];

export const SFX: SfxRecipe[] = [
  { id: 'throw', prompt: 'Quick cartoon whoosh of a soft ball being thrown, short and airy', seconds: 0.6, influence: 0.5 },
  { id: 'blaster', prompt: 'Short punchy sci-fi laser blaster shot, bright pew, cartoon arcade game, no echo', seconds: 0.5, influence: 0.6 },
  { id: 'scatter', prompt: 'Chunky sci-fi spread gun blast, several overlapping energy zaps at once with a low thump, cartoon arcade game', seconds: 0.7, influence: 0.6 },
  { id: 'rail', prompt: 'Sci-fi railgun shot: quick rising electric charge whine then a sharp crack and sizzle, cartoon arcade game', seconds: 1, influence: 0.6 },
  { id: 'switch', prompt: 'Quick mechanical sci-fi weapon swap, click and short power-up hum, game UI sound', seconds: 0.5, influence: 0.6 },
  { id: 'hit', prompt: 'Cartoon soft ball hitting a character, bouncy boing with a light thud', seconds: 0.7, influence: 0.5 },
  { id: 'freeze', prompt: 'Magical ice freezing sound, quick crackle and sparkly shimmer, cartoon game', seconds: 1.2, influence: 0.5 },
  { id: 'correct', prompt: 'Happy bright two-note chime for a correct answer in a kids game, marimba', seconds: 0.9, influence: 0.6 },
  { id: 'wrong', prompt: 'Gentle comic wrong-answer sound, soft descending kazoo wah-wah, not harsh', seconds: 1, influence: 0.6 },
  { id: 'knockout', prompt: 'Cartoon character knocked out, comic slide whistle down then a soft plop, kids game', seconds: 1.2, influence: 0.6 },
  { id: 'respawn', prompt: 'Cheerful magical pop and sparkle as a cartoon character reappears, short and bright', seconds: 0.8, influence: 0.5 },
];

/** Shared by every track, so they sit under the game the same way. */
const LOOP = 'steady energy with no big build-ups so it sits under sound effects, ends where it began for seamless looping.';

export const MUSIC: MusicRecipe[] = [
  {
    theme: 'park',
    prompt:
      'Light, bouncy instrumental background loop for a cheerful kids arena game in a sunny park: ' +
      'ukulele, glockenspiel, soft claps and whistling, 115 BPM, playful and upbeat, ' + LOOP,
    lengthMs: 60_000,
  },
  {
    theme: 'classic',
    prompt:
      'Upbeat instrumental background loop for a friendly kids sports arena game: bright funk bass, ' +
      'clean electric guitar, light drums and handclaps, 112 BPM, sporty and fun, ' + LOOP,
    lengthMs: 45_000,
  },
  {
    theme: 'schoolyard',
    prompt:
      'Playful instrumental background loop for a kids game in a schoolyard at recess: pizzicato strings, ' +
      'xylophone, bouncy bass and snaps, 118 BPM, mischievous and cheerful, ' + LOOP,
    lengthMs: 45_000,
  },
  {
    theme: 'beach',
    prompt:
      'Sunny instrumental background loop for a kids game on a tropical beach: steel drums, marimba, ' +
      'shakers and laid-back bass, 105 BPM, relaxed but bouncy, ' + LOOP,
    lengthMs: 45_000,
  },
  {
    theme: 'snow',
    prompt:
      'Cosy wintry instrumental background loop for a kids snowball game: sleigh bells, celesta, ' +
      'pizzicato strings and soft brushed drums, 110 BPM, frosty and cheerful, ' + LOOP,
    lengthMs: 45_000,
  },
  {
    theme: 'library',
    prompt:
      'Light, curious instrumental background loop for a kids game in a library: tiptoeing pizzicato, ' +
      'harpsichord, clarinet and soft woodblocks, 100 BPM, sneaky and playful, gentle volume, ' + LOOP,
    lengthMs: 45_000,
  },
  {
    theme: 'space',
    prompt:
      'Playful instrumental background loop for a kids game on a space station: bubbly retro synths, ' +
      'arpeggios, soft electronic drums, 112 BPM, curious and upbeat, friendly not scary, ' + LOOP,
    lengthMs: 45_000,
  },
];
