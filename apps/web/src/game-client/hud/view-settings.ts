import type { CameraView } from '@volleyland/game-core';

/** Each player's own view preferences, kept in this browser only. */
export interface ViewSettings {
  /** The view the player picked (used when the admin lets players choose), or null for the default. */
  choice: CameraView | null;
  /** First-person mouse look speed, 0.25–3×. */
  sensitivity: number;
}

export const DEFAULT_VIEW: ViewSettings = { choice: null, sensitivity: 1 };

const KEY = 'volleyland.view';

export function loadViewSettings(): ViewSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ViewSettings> | null;
    if (!saved || typeof saved !== 'object') return DEFAULT_VIEW;
    return {
      choice: saved.choice === 'first-person' || saved.choice === 'third-person' ? saved.choice : null,
      sensitivity: typeof saved.sensitivity === 'number' && saved.sensitivity >= 0.25 && saved.sensitivity <= 3 ? saved.sensitivity : DEFAULT_VIEW.sensitivity,
    };
  } catch {
    // No storage (private window, blocked site data, server render): the defaults.
    return DEFAULT_VIEW;
  }
}

export function saveViewSettings(settings: ViewSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not saved; the settings still apply for this visit.
  }
}
