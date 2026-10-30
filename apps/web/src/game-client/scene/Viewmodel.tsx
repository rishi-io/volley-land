'use client';

import { useFrame } from '@react-three/fiber';
import { useWorld } from 'koota/react';
import { useRef } from 'react';
import { type Mesh, Quaternion, Vector3 } from 'three';
import { gunGeometry, sharedAssets } from '../character/assets';
import { Anim, IsLocal, Vitals } from '../ecs/traits';
import { useRuntime } from '../runtime';
import { readiness } from '../weapons';

/** Where the ball or gun sits in view (camera space, metres): low on the right, held, clear of the crosshair. */
const REST = new Vector3(0.22, -0.2, -0.5);
const GUN_REST = new Vector3(0.17, -0.15, -0.46);
/** Guns are modelled at hand size; this close to the eye they are drawn a little smaller so they do not fill the view. */
const GUN_SCALE = 0.7;
/** How long a gun's recoil kick takes to settle. */
const RECOIL_MS = 140;
const offset = new Vector3();
/** Guns are modelled pointing along +z; the camera looks along −z. Turned a little in towards the crosshair, so their side shows. */
const FACE_FORWARD = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI + 0.22);
const kick = new Quaternion();
const X_AXIS = new Vector3(1, 0, 0);

/**
 * First person: what the player holds, low on the right. Throws leave from the crosshair. The ball
 * flies off on a throw and comes back up when the next one is ready; a gun kicks on each shot and
 * dips while it reloads (or while it is being switched to), so the reload can be seen. Hidden in
 * third person and while frozen or knocked out.
 */
export function Viewmodel() {
  const runtime = useRuntime();
  const world = useWorld();
  const ball = useRef<Mesh>(null);
  const gun = useRef<Mesh>(null);

  useFrame(({ camera }) => {
    if (!ball.current || !gun.current) return;
    const local = world.queryFirst(IsLocal);
    const alive = local?.get(Vitals)?.status === 'alive';
    const shown = runtime.view === 'first-person' && alive;
    const geometry = gunGeometry(runtime.weapon);
    ball.current.visible = shown && geometry === null;
    gun.current.visible = shown && geometry !== null;
    if (!shown) return;

    const now = performance.now();
    // 0 just after a shot or switch, 1 once the next shot is ready; the weapon rises back into the hand.
    const rise = 1 - (1 - readiness(runtime, now)) ** 3;

    if (geometry === null) {
      offset.copy(REST);
      offset.y -= (1 - rise) * 0.35;
      offset.z -= (1 - rise) * 0.1;
      ball.current.position.copy(offset.applyQuaternion(camera.quaternion).add(camera.position));
      ball.current.scale.setScalar(runtime.config.projectileRadius * 0.17 * (0.6 + 0.4 * rise));
      return;
    }

    const mesh = gun.current;
    if (mesh.geometry !== geometry) mesh.geometry = geometry;
    const since = now - (local?.get(Anim)?.throwAt ?? -1e9);
    const recoil = since < RECOIL_MS ? 1 - since / RECOIL_MS : 0;
    offset.copy(GUN_REST);
    offset.y -= (1 - rise) * 0.12;
    offset.z += recoil * 0.06;
    mesh.position.copy(offset.applyQuaternion(camera.quaternion).add(camera.position));
    mesh.quaternion.copy(camera.quaternion).multiply(FACE_FORWARD).multiply(kick.setFromAxisAngle(X_AXIS, -recoil * 0.25));
  });

  return (
    <>
      <mesh ref={ball} visible={false} renderOrder={10} frustumCulled={false}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshLambertMaterial color="#ffb703" />
      </mesh>
      <mesh ref={gun} visible={false} renderOrder={10} frustumCulled={false} scale={GUN_SCALE} material={sharedAssets().details} />
    </>
  );
}
