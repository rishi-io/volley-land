/** Each player's own volume settings, kept in this browser only. */
export interface SoundSettings {
  master: number;
  music: number;
  sfx: number;
  voice: number;
  muted: boolean;
}

export const DEFAULT_SOUND: SoundSettings = { master: 0.8, music: 0.45, sfx: 0.8, voice: 0.9, muted: false };

const KEY = 'volleyland.sound';

export function loadSoundSettings(): SoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<SoundSettings> | null;
    if (!saved || typeof saved !== 'object') return DEFAULT_SOUND;
    const level = (v: unknown, fallback: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback);
    return {
      master: level(saved.master, DEFAULT_SOUND.master),
      music: level(saved.music, DEFAULT_SOUND.music),
      sfx: level(saved.sfx, DEFAULT_SOUND.sfx),
      voice: level(saved.voice, DEFAULT_SOUND.voice),
      muted: saved.muted === true,
    };
  } catch {
    // No storage (private window, blocked site data, server render): play at the defaults.
    return DEFAULT_SOUND;
  }
}

export function saveSoundSettings(settings: SoundSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not saved; the settings still apply for this visit.
  }
}
