'use client';

import { Canvas } from '@react-three/fiber';
import { type AppearanceSettings, DEFAULT_GAME_CONFIG } from '@volleyland/game-core';
import { useState } from 'react';
import { Character } from '@/game-client/character/Character';
import type { CharacterFrame } from '@/game-client/character/motion';

const { playerRadius: radius, playerHeight: height, playerSpeed: speed, startingHealth } = DEFAULT_GAME_CONFIG;
const FACING_CAMERA = Math.PI;

interface Demo {
  label: string;
  bot?: boolean;
  isLocal?: boolean;
  health: number;
  /** What this character is doing at time t (seconds). */
  act: (t: number, out: CharacterFrame, x: number) => void;
}

const idle = (out: CharacterFrame, x: number) => {
  out.x = x;
  out.z = 0;
  out.yaw = FACING_CAMERA;
  out.status = 'alive';
  out.protected = false;
};

/** One character per behaviour, so every setting has something visible to change. */
const DEMOS: Demo[] = [
  {
    label: 'You',
    isLocal: true,
    health: 100,
    act: (t, out, x) => {
      idle(out, x);
      out.x = x + Math.sin(t * 2.4) * 0.9;
      out.z = Math.cos(t * 2.4) * 0.9;
    },
  },
  {
    label: 'Player',
    health: 75,
    act: (t, out, x) => {
      idle(out, x);
      out.throwAt = performance.now() - ((t * 1000) % 1800);
    },
  },
  {
    label: 'Player',
    health: 50,
    act: (t, out, x) => {
      idle(out, x);
      out.hitAt = performance.now() - ((t * 1000) % 2200);
    },
  },
  {
    label: 'Player',
    health: 25,
    act: (t, out, x) => {
      idle(out, x);
      out.status = t % 4 < 2.6 ? 'frozen' : 'alive';
      out.protected = out.status === 'frozen';
    },
  },
  {
    label: 'Player',
    health: 100,
    act: (t, out, x) => {
      idle(out, x);
      out.status = t % 3.5 < 0.9 ? 'dead' : 'alive';
      out.protected = out.status === 'alive' && t % 3.5 < 2;
    },
  },
  {
    label: 'Bot 1',
    bot: true,
    health: 60,
    act: (t, out, x) => {
      idle(out, x);
      out.x = x + Math.sin(t * 1.6) * 0.8;
    },
  },
];

/** A live preview of the character settings: the same Character the game draws, acting out each state. */
export default function CharacterPreview({ appearance }: { appearance: AppearanceSettings }) {
  const spacing = 1.9;
  // The camera looks along +z (as in the game), so +x is on the left: start there to read left to right.
  const start = ((DEMOS.length - 1) * spacing) / 2;
  const [t0] = useState(() => performance.now());
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ fov: 20, position: [0, 3.2, -10.5], near: 0.1, far: 60 }}
      onCreated={({ camera }) => camera.lookAt(0, 1.15, 0)}
      aria-label="Character preview: running, throwing, being hit, frozen, knocked out and a bot"
    >
      <color attach="background" args={['#151d2c']} />
      <hemisphereLight args={['#dfe7ff', '#1b2333', 1.1]} />
      <directionalLight position={[8, 20, -6]} intensity={1.2} />
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[16, 6]} />
        <meshLambertMaterial color="#2b3a55" />
      </mesh>
      {DEMOS.map((demo, i) => (
        <Character
          key={i}
          appearance={appearance}
          look={i}
          bot={demo.bot ?? false}
          isLocal={demo.isLocal ?? false}
          label={demo.label}
          radius={radius}
          height={height}
          maxHealth={startingHealth}
          runSpeed={speed}
          sample={(out) => {
            out.health = (demo.health / 100) * startingHealth;
            out.throwAt = out.hitAt = -1e9;
            demo.act((performance.now() - t0) / 1000, out, start - i * spacing);
            return true;
          }}
        />
      ))}
    </Canvas>
  );
}
