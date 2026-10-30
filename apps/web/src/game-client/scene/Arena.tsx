'use client';

import { usePrefersReducedMotion } from '../character/Character';
import { useHud } from '../hud/hud-store';
import { useRuntime } from '../runtime';
import { WorldScene } from '../world/WorldScene';

/** The world being played. (The pointer's aim point is found by the game loop, against the arena's ground.) */
export function Arena({ detail }: { detail: 'full' | 'low' }) {
  const runtime = useRuntime();
  useHud((s) => s.setupRevision); // redraw when the match setup changes
  const reducedMotion = usePrefersReducedMotion();
  return <WorldScene layout={runtime.layout} detail={detail} motion={!reducedMotion} />;
}
