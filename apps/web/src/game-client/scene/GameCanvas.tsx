'use client';

import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { useHud } from '../hud/hud-store';
import { useRuntime } from '../runtime';
import { Arena } from './Arena';
import { CameraRig, THIRD_PERSON_FOV, ZOOM_LIMITS } from './CameraRig';
import { GameLoop } from './GameLoop';
import { Players } from './Players';
import { Projectiles } from './Projectiles';
import { Viewmodel } from './Viewmodel';

/** Quality scaling: drop the render resolution when frame rate sags, raise it when there is headroom. */
const MIN_DPR = 0.6;

export function GameCanvas() {
  const runtime = useRuntime();
  const maxDpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio, 1.5);
  const [dpr, setDpr] = useState(maxDpr);
  runtime.dpr = dpr;

  return (
    <Canvas
      dpr={dpr}
      camera={{ fov: THIRD_PERSON_FOV, position: [0, 16, -12], near: 0.05, far: 600 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        const context = gl.getContext();
        const info = context.getExtension('WEBGL_debug_renderer_info');
        runtime.gpu = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
      }}
      aria-label="Volleyland arena"
      onWheel={(e) => {
        if (runtime.view === 'first-person') return;
        runtime.zoom = Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, runtime.zoom * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
      }}
    >
      <PerformanceMonitor
        onDecline={() => setDpr((d) => Math.max(MIN_DPR, Number((d - 0.2).toFixed(2))))}
        onIncline={() => setDpr((d) => Math.min(maxDpr, Number((d + 0.2).toFixed(2))))}
      />
      <Arena detail={dpr <= MIN_DPR ? 'low' : 'full'} />
      <Players />
      <Projectiles />
      {/* The loop runs first each frame, so the camera and the ball in hand show this frame's position (what a throw aims from). */}
      <GameLoop />
      <CameraRig />
      <Viewmodel />
      <PointerControls />
    </Canvas>
  );
}

/** Wires the mouse to the canvas: aim and throw, and first-person look. */
function PointerControls() {
  const runtime = useRuntime();
  const element = useThree((s) => s.gl.domElement);
  useEffect(() => {
    runtime.pointer.onLockChange = (locked) => useHud.getState().set({ pointerLocked: locked });
    const detach = runtime.pointer.attach(element);
    return () => {
      runtime.pointer.onLockChange = null;
      detach();
    };
  }, [element, runtime]);
  return null;
}
