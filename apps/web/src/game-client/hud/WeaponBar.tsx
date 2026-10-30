'use client';

import { WEAPON_IDS } from '@volleyland/game-core';
import { useEffect, useRef } from 'react';
import { useRuntime } from '../runtime';
import { WEAPON_COLORS, WEAPON_NAMES, readiness, selectWeapon } from '../weapons';
import { useHud } from './hud-store';

/**
 * The weapons this match allows, with their keys, the one in hand and its reload. The reload bar
 * is written to the DOM every frame from the runtime, never through React state.
 */
export function WeaponBar() {
  const runtime = useRuntime();
  const weapons = useHud((s) => s.weapons);
  const weapon = useHud((s) => s.weapon);
  const status = useHud((s) => s.status);
  const reload = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      if (reload.current) reload.current.style.transform = `scaleX(${readiness(runtime, performance.now())})`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [runtime]);

  if (weapons.length < 2 || status === 'dead') return null;
  return (
    <ol className="weapons" aria-label="Weapons">
      {weapons.map((w) => {
        const active = w === weapon;
        return (
          <li key={w}>
            <button
              type="button"
              className={active ? 'weapon weapon--active' : 'weapon'}
              style={{ ['--weapon' as string]: WEAPON_COLORS[w] }}
              aria-pressed={active}
              // Clicking a slot must not also count as a shot on the canvas.
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => selectWeapon(runtime, w)}
            >
              <kbd>{WEAPON_IDS.indexOf(w) + 1}</kbd>
              {WEAPON_NAMES[w]}
              {active && <span ref={reload} className="weapon__reload" aria-hidden />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
