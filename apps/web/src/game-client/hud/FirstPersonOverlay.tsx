'use client';

import { useHud } from './hud-store';

/**
 * First person only: the crosshair, a frosty edge while frozen, and the prompt to click into the
 * game (the browser only lets the mouse be captured after a click, and lets it go on Esc).
 */
export function FirstPersonOverlay() {
  const view = useHud((s) => s.view);
  const locked = useHud((s) => s.pointerLocked);
  const status = useHud((s) => s.status);
  const question = useHud((s) => s.question);
  const connection = useHud((s) => s.connection);
  if (view !== 'first-person' || connection !== 'connected') return null;
  return (
    <>
      {status === 'frozen' && <div className="frost" aria-hidden />}
      {status === 'alive' && <div className="crosshair" aria-hidden />}
      {!locked && !question && (
        <p className="look-prompt" role="status">
          Click to look around · Esc frees the mouse
        </p>
      )}
    </>
  );
}
