'use client';

import { useFrame } from '@react-three/fiber';
import { WEAPON_IDS, type WeaponId, weaponStats } from '@volleyland/game-core';
import { useWorld } from 'koota/react';
import { useEffect, useMemo, useRef } from 'react';
import { type BufferGeometry, CapsuleGeometry, type InstancedMesh, Object3D, SphereGeometry, Vector3 } from 'three';
import { IsProjectile, PredictedProjectile, Shot, Transform } from '../ecs/traits';
import { useHud } from '../hud/hud-store';
import { useRuntime } from '../runtime';
import { WEAPON_COLORS } from '../weapons';

const POOL_SIZE = 64;

/** How long each weapon's shot is drawn, m: the blasters' bolts are streaks along their flight, the ball is round. */
const STREAK: Readonly<Record<WeaponId, number>> = { ball: 0, blaster: 0.9, scatter: 0.35, rail: 3 };

/** A shot's shape, its head at the origin and its tail trailing back along −z (it is turned to face its flight). */
function shotGeometry(weapon: WeaponId, radius: number): BufferGeometry {
  const length = STREAK[weapon];
  if (length === 0) return new SphereGeometry(radius, 12, 8);
  return new CapsuleGeometry(radius, length, 3, 8).rotateX(Math.PI / 2).translate(0, 0, -length / 2);
}

/** Every projectile — server and predicted — drawn from one pooled InstancedMesh per weapon (four draw calls at most). */
export function Projectiles() {
  useHud((s) => s.setupRevision); // sizes come from the match rules
  return (
    <>
      {WEAPON_IDS.map((weapon) => (
        <WeaponShots key={weapon} weapon={weapon} />
      ))}
    </>
  );
}

function WeaponShots({ weapon }: { weapon: WeaponId }) {
  const world = useWorld();
  const { config } = useRuntime();
  const radius = weaponStats(config, weapon).radius;
  const geometry = useMemo(() => shotGeometry(weapon, radius), [weapon, radius]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const mesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const ahead = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const instances = mesh.current;
    if (!instances) return;
    let count = 0;
    const place = ([transform, shot]: [{ x: number; y: number; z: number }, { weapon: WeaponId; dx: number; dy: number; dz: number }, ...unknown[]]) => {
      if (count >= POOL_SIZE || shot.weapon !== weapon) return;
      dummy.position.set(transform.x, transform.y, transform.z);
      dummy.lookAt(ahead.set(transform.x + shot.dx, transform.y + shot.dy, transform.z + shot.dz));
      dummy.updateMatrix();
      instances.setMatrixAt(count++, dummy.matrix);
    };
    world.query(Transform, Shot, IsProjectile).readEach(place);
    world.query(Transform, Shot, PredictedProjectile).readEach(place);
    instances.count = count;
    instances.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, POOL_SIZE]} frustumCulled={false}>
      {weapon === 'ball' ? (
        <meshLambertMaterial color={WEAPON_COLORS.ball} />
      ) : (
        // Unlit and untoned: energy bolts glow the same in every light.
        <meshBasicMaterial color={WEAPON_COLORS[weapon]} toneMapped={false} />
      )}
    </instancedMesh>
  );
}
