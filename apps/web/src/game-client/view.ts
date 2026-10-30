import { type CameraView, viewFor } from '@volleyland/game-core';
import { useHud } from './hud/hud-store';
import { saveViewSettings } from './hud/view-settings';
import type { GameRuntime } from './runtime';

/**
 * Put the right view into effect: the admin's default, or the player's own choice when players
 * may choose. Called when a match setup arrives and when the player switches or changes look speed.
 */
export function applyView(runtime: GameRuntime): void {
  const hud = useHud.getState();
  const view = viewFor(hud.camera, hud.viewSettings.choice);
  const { pointer } = runtime;
  pointer.sensitivity = hud.viewSettings.sensitivity;
  if (view !== runtime.view) {
    if (view === 'first-person') {
      // Look the way the character was facing, level.
      pointer.look.yaw = runtime.localYaw;
      pointer.look.pitch = 0;
    } else {
      pointer.release();
    }
  }
  runtime.view = view;
  pointer.firstPerson = view === 'first-person';
  if (hud.view !== view) hud.set({ view });
}

/** Switch between first and third person (V), when the admin lets players choose. */
export function toggleView(runtime: GameRuntime): void {
  const hud = useHud.getState();
  if (!hud.camera.playerChoice) return;
  const choice: CameraView = runtime.view === 'first-person' ? 'third-person' : 'first-person';
  const viewSettings = { ...hud.viewSettings, choice };
  saveViewSettings(viewSettings);
  hud.set({ viewSettings });
  applyView(runtime);
  // Switching with the keyboard is not a click, so the pointer can only be captured on the next one.
}

/** Set the first-person look speed (0.25–3×). */
export function setLookSensitivity(runtime: GameRuntime, sensitivity: number): void {
  const hud = useHud.getState();
  const viewSettings = { ...hud.viewSettings, sensitivity: Math.max(0.25, Math.min(3, sensitivity)) };
  saveViewSettings(viewSettings);
  hud.set({ viewSettings });
  applyView(runtime);
}

/** Turn the player towards the middle of the world (spawn points are round the edge), level: on joining and respawning. */
export function faceCentre(runtime: GameRuntime, at: { x: number; z: number }): void {
  if (Math.hypot(at.x, at.z) < 1) return;
  runtime.localYaw = runtime.pointer.look.yaw = Math.atan2(-at.x, -at.z);
  runtime.pointer.look.pitch = 0;
}
