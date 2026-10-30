'use client';

import type { PointerEvent } from 'react';
import type { SoundSettings } from '../audio/sound-settings';
import { useRuntime } from '../runtime';
import { setLookSensitivity, toggleView } from '../view';
import { useHud } from './hud-store';

const LEVELS: { key: Exclude<keyof SoundSettings, 'muted'>; label: string }[] = [
  { key: 'master', label: 'Volume' },
  { key: 'music', label: 'Music' },
  { key: 'sfx', label: 'Effects' },
  { key: 'voice', label: 'Bot voices' },
];

/** Keeps a mouse click from leaving focus on a control, where Space (throw) or arrows (move) would work it. */
const keepFocusOnGame = { onPointerUp: (e: PointerEvent<HTMLElement>) => e.currentTarget.blur() };

/**
 * The view and sound buttons, and the settings panel (volumes, and look speed in first person).
 * Settings are this player's own, saved in the browser.
 */
export function SoundControls() {
  const runtime = useRuntime();
  const sound = useHud((s) => s.sound);
  const open = useHud((s) => s.showSound);
  const set = useHud((s) => s.set);
  const view = useHud((s) => s.view);
  const canSwitch = useHud((s) => s.camera.playerChoice);
  const sensitivity = useHud((s) => s.viewSettings.sensitivity);
  const change = (partial: Partial<SoundSettings>) => set({ sound: { ...sound, ...partial } });
  const silent = sound.muted || sound.master === 0;

  return (
    <div className="sound">
      <div className="sound__buttons">
        {canSwitch && (
          <button
            type="button"
            className="sound__button sound__button--wide"
            {...keepFocusOnGame}
            aria-label={view === 'first-person' ? 'Switch to third person (V)' : 'Switch to first person (V)'}
            title="Switch view (V)"
            onClick={() => toggleView(runtime)}
          >
            {view === 'first-person' ? '3rd' : '1st'}
          </button>
        )}
        <button
          type="button"
          className="sound__button"
          {...keepFocusOnGame}
          aria-label={silent ? 'Unmute sound' : 'Mute sound'}
          aria-pressed={sound.muted}
          onClick={() => change({ muted: !sound.muted })}
        >
          {silent ? '🔇' : '🔊'}
        </button>
        <button
          type="button"
          className="sound__button"
          {...keepFocusOnGame}
          aria-label="Sound and view settings"
          aria-expanded={open}
          onClick={() => set({ showSound: !open })}
        >
          ⚙
        </button>
      </div>
      {open && (
        <div className="sound__panel" role="group" aria-label="Sound and view settings">
          {LEVELS.map(({ key, label }) => (
            <label key={key} className="sound__level">
              <span>{label}</span>
              <input
                type="range"
                {...keepFocusOnGame}
                min={0}
                max={100}
                step={5}
                value={Math.round(sound[key] * 100)}
                onChange={(e) => change({ [key]: Number(e.target.value) / 100, ...(key === 'master' && { muted: false }) })}
              />
            </label>
          ))}
          {view === 'first-person' && (
            <label className="sound__level">
              <span>Look speed</span>
              <input
                type="range"
                {...keepFocusOnGame}
                min={25}
                max={300}
                step={5}
                value={Math.round(sensitivity * 100)}
                onChange={(e) => setLookSensitivity(runtime, Number(e.target.value) / 100)}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}
