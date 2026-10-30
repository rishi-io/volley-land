'use client';

import { createWorld } from 'koota';
import { WorldProvider } from 'koota/react';
import { useEffect, useState } from 'react';
import { Hud } from './hud/Hud';
import { useHud } from './hud/hud-store';
import { resolveServerUrl } from '@/lib/server-url';
import { GameConnection } from './net/connection';
import { type GameRuntime, RuntimeContext, createRuntime } from './runtime';
import { ZOOM_LIMITS } from './scene/CameraRig';
import { GameCanvas } from './scene/GameCanvas';
import { GameSession } from './session';
import { toggleView } from './view';
import { cycleWeapon, selectWeapon, weaponForKey } from './weapons';

export default function Game({ roomCode }: { roomCode: string }) {
  const [world] = useState(() => createWorld());
  const [runtime] = useState(() => createRuntime());

  useEffect(() => {
    const session = new GameSession(new GameConnection(resolveServerUrl()), runtime, world);
    void session.start(roomCode);

    const detachKeyboard = runtime.keyboard.attach(window);
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'F3') {
        event.preventDefault();
        useHud.getState().set({ showMetrics: !useHud.getState().showMetrics });
      } else if (event.code === 'KeyM' && !useHud.getState().question) {
        useHud.getState().set({ showMinimap: !useHud.getState().showMinimap });
      } else if (event.code === 'KeyV' && !event.repeat && !useHud.getState().question) {
        toggleView(runtime);
      } else if (event.code === 'KeyQ' && !event.repeat && !useHud.getState().question) {
        cycleWeapon(runtime);
      } else if (weaponForKey(event.code) && !event.repeat && !useHud.getState().question) {
        // While a question is open, 1–4 answer it instead.
        selectWeapon(runtime, weaponForKey(event.code)!);
      } else if (runtime.view === 'first-person') {
        // No zoom in first person.
      } else if (event.code === 'Equal' || event.code === 'Minus' || event.code === 'NumpadAdd' || event.code === 'NumpadSubtract') {
        const zoomIn = event.code === 'Equal' || event.code === 'NumpadAdd';
        runtime.zoom = Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, runtime.zoom * (zoomIn ? 1 / 1.15 : 1.15)));
      }
    };
    window.addEventListener('keydown', onKey);
    const hideFromCapture = exposeForCapture(runtime);
    // Browsers allow sound only after the player interacts; any click or key starts it.
    const unlockAudio = () => runtime.audio?.unlock();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    return () => {
      hideFromCapture();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('keydown', onKey);
      detachKeyboard();
      session.dispose();
    };
  }, [roomCode, runtime, world]);

  return (
    <WorldProvider world={world}>
      <RuntimeContext.Provider value={runtime}>
        <div className="game">
          <GameCanvas />
          <Hud />
        </div>
      </RuntimeContext.Provider>
    </WorldProvider>
  );
}

/**
 * Dev builds only: puts the runtime on `window.__volleyland`, so a capture script (the trailer's
 * scripts/trailer/) can set `runtime.director` and film the game with a scripted camera.
 */
function exposeForCapture(runtime: GameRuntime): () => void {
  if (process.env.NODE_ENV === 'production') return () => {};
  const host = window as unknown as { __volleyland?: { runtime: GameRuntime } };
  host.__volleyland = { runtime };
  return () => {
    runtime.director = null;
    delete host.__volleyland;
  };
}
