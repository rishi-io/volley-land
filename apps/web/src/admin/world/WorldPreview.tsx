'use client';

import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { WorldLayoutDto } from '@volleyland/contracts';
import { type AppearanceSettings, DEFAULT_GAME_CONFIG, buildHeightField, heightAt } from '@volleyland/game-core';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { eyeHeight } from '@/game-client/aim';
import { Character } from '@/game-client/character/Character';
import { WorldScene } from '@/game-client/world/WorldScene';
import styles from '../admin.module.css';

const { playerRadius: radius, playerHeight: height, playerSpeed: speed, startingHealth } = DEFAULT_GAME_CONFIG;

type Camera = 'overview' | 'player' | 'eyes';

/**
 * The world in 3D, drawn by the same scene the game uses, with a character standing on each
 * spawn point for scale. Orbit with the mouse; "Third person" puts the camera where the game
 * camera sits behind spawn point 1, "First person" at that player's eyes.
 */
export default function WorldPreview({ layout, appearance, projectileHeight }: { layout: WorldLayoutDto; appearance: AppearanceSettings; projectileHeight: number }) {
  // First-person eyes are at throw height, as in the game.
  const eye = eyeHeight({ projectileHeight });
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [camera, setCamera] = useState<Camera>('overview');
  const span = Math.max(layout.halfWidth, layout.halfDepth) * 2;
  const field = useMemo(() => buildHeightField(layout), [layout]);
  const ground = (x: number, z: number) => heightAt(field, x, z);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const spawn = layout.spawnPoints[0] ?? { x: 0, z: 0 };
    const y = heightAt(field, spawn.x, spawn.z);
    if (camera === 'overview') {
      c.target.set(0, 0, 0);
      c.object.position.set(0, span * 0.62, -span * 0.78);
    } else if (camera === 'player') {
      // Where the third-person camera sits: 16 m up and 12 m behind the player, looking at them.
      c.target.set(spawn.x, y, spawn.z);
      c.object.position.set(spawn.x, y + 16, spawn.z - 12);
    } else {
      // Through the eyes of a player on spawn point 1, looking towards the middle (as the game turns them on joining).
      const d = Math.hypot(spawn.x, spawn.z) || 1;
      c.object.position.set(spawn.x, y + eye, spawn.z);
      c.target.set(spawn.x - (spawn.x / d) * 0.1, y + eye, spawn.z - (spawn.z / d) * 0.1);
    }
    c.update();
  }, [camera, span, layout.spawnPoints, field, eye]);

  return (
    <div className={styles.previewPane}>
      <div className={styles.previewCanvas3d}>
        <Canvas dpr={[1, 1.5]} camera={{ fov: 50, position: [0, span * 0.62, -span * 0.78], near: 0.1, far: 900 }} aria-label="3D preview of the world">
          <WorldScene layout={layout} fogScale={camera === 'overview' ? Math.max(1, span / 45) : 1}>
            {layout.spawnPoints.map((p, i) => (
              <Character
                key={i}
                appearance={appearance}
                look={i}
                bot={false}
                isLocal={i === 0}
                label={`Spawn ${i + 1}`}
                radius={radius}
                height={height}
                maxHealth={startingHealth}
                runSpeed={speed}
                sample={(out) => {
                  // In first person the camera is this player's eyes.
                  if (i === 0 && camera === 'eyes') return false;
                  out.x = p.x;
                  out.y = ground(p.x, p.z);
                  out.z = p.z;
                  out.yaw = Math.atan2(-p.x, -p.z);
                  out.status = 'alive';
                  out.protected = false;
                  out.health = startingHealth;
                  out.throwAt = out.hitAt = -1e9;
                  return true;
                }}
              />
            ))}
          </WorldScene>
          <OrbitControls ref={controls} makeDefault maxPolarAngle={camera === 'eyes' ? Math.PI : Math.PI / 2.05} minDistance={camera === 'eyes' ? 0.05 : 4} maxDistance={span * 2.5} />
        </Canvas>
      </div>
      <div className={styles.previewBar} role="group" aria-label="Camera">
        <button type="button" className={styles.secondary} aria-pressed={camera === 'overview'} onClick={() => setCamera('overview')}>
          Overview
        </button>
        <button type="button" className={styles.secondary} aria-pressed={camera === 'player'} onClick={() => setCamera('player')}>
          Third person
        </button>
        <button type="button" className={styles.secondary} aria-pressed={camera === 'eyes'} onClick={() => setCamera('eyes')}>
          First person
        </button>
        <span className={styles.toolbarHint}>Drag to orbit, right-drag to pan, scroll to zoom.</span>
      </div>
    </div>
  );
}
