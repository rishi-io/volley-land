'use client';

import { lookOf } from '@volleyland/game-core';
import { useWorld } from 'koota/react';
import { useEffect, useRef } from 'react';
import { IsLocal, IsPlayer, Look, Transform, Vitals } from '../ecs/traits';
import { useRuntime } from '../runtime';
import { drawWorldMap } from '../world/world-map';
import { useHud } from './hud-store';

const MAX_SIDE = 180;

/**
 * A map of the whole world in the corner, with every player on it (you as an arrow). The world
 * is drawn once per match setup; players are redrawn a few times a second. M hides it.
 */
export function Minimap() {
  const world = useWorld();
  const runtime = useRuntime();
  const revision = useHud((s) => s.setupRevision);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const { layout } = runtime;
    const scale = MAX_SIDE / (Math.max(layout.halfWidth, layout.halfDepth) * 2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(layout.halfWidth * 2 * scale);
    const h = Math.round(layout.halfDepth * 2 * scale);
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    const background = document.createElement('canvas');
    background.width = el.width;
    background.height = el.height;
    drawWorldMap(background.getContext('2d')!, layout, scale * dpr);

    const ctx = el.getContext('2d')!;
    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 100) return;
      last = now;
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.drawImage(background, 0, 0);
      const toX = (x: number) => el.width / 2 - x * scale * dpr;
      const toY = (z: number) => el.height / 2 - z * scale * dpr;
      for (const entity of world.query(IsPlayer, Transform, Look, Vitals)) {
        const t = entity.get(Transform)!;
        const vitals = entity.get(Vitals)!;
        if (vitals.status === 'dead') continue;
        const local = entity.has(IsLocal);
        const x = toX(t.x);
        const y = toY(t.z);
        ctx.fillStyle = local ? '#ffffff' : lookOf(entity.get(Look)!.look, runtime.appearance.palette).color;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        if (local) {
          // An arrow along the player's facing: yaw 0 is +z (up on the map), +x is to the left.
          const r = 6 * dpr;
          const a = Math.PI - t.yaw;
          ctx.moveTo(x + Math.sin(a) * r, y + Math.cos(a) * r);
          ctx.lineTo(x + Math.sin(a + 2.5) * r * 0.8, y + Math.cos(a + 2.5) * r * 0.8);
          ctx.lineTo(x + Math.sin(a - 2.5) * r * 0.8, y + Math.cos(a - 2.5) * r * 0.8);
          ctx.closePath();
        } else {
          ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [revision, runtime, world]);

  return <canvas ref={canvas} className="minimap" role="img" aria-label="Map of the world with every player's position" />;
}
