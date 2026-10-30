'use client';

import { useFrame } from '@react-three/fiber';
import { groundHeight } from '@volleyland/game-core';
import type { World } from 'koota';
import { useWorld } from 'koota/react';
import type { PerspectiveCamera } from 'three';
import { eyeHeight } from '../aim';
import { IsLocal, IsPlayer, Look, NetId, Transform, Vitals } from '../ecs/traits';
import { type Director, useRuntime } from '../runtime';

const HEIGHT = 16;
const BEHIND = 12;
export const ZOOM_LIMITS = { min: 0.7, max: 1.8 } as const;
export const THIRD_PERSON_FOV = 50;
/** The third-person camera keeps at least this far above the ground under it (a hill behind the player). */
const GROUND_CLEARANCE = 2;

/**
 * Third person: follows the local player from behind and above, with frame-rate independent
 * smoothing; zoom scales the distance. First person: at the player's eyes, turned by the mouse.
 */
export function CameraRig() {
  const world = useWorld();
  const runtime = useRuntime();
  useFrame(({ camera }, delta) => {
    if (runtime.director && directed(runtime.director, world, camera as PerspectiveCamera)) return;
    const local = world.queryFirst(IsLocal, Transform);
    const transform = local?.get(Transform);
    if (!transform) return;
    const firstPerson = runtime.view === 'first-person';
    const perspective = camera as PerspectiveCamera;
    const fov = firstPerson ? runtime.camera.firstPersonFov : THIRD_PERSON_FOV;
    if (perspective.fov !== fov) {
      perspective.fov = fov;
      perspective.updateProjectionMatrix();
    }

    if (firstPerson) {
      const { yaw, pitch } = runtime.pointer.look;
      camera.position.set(transform.x, transform.y + eyeHeight(runtime.config), transform.z);
      // three.js cameras look along −z: turning by yaw + π looks along (sin yaw, cos yaw).
      camera.rotation.set(pitch, yaw + Math.PI, 0, 'YXZ');
      return;
    }

    const height = HEIGHT * runtime.zoom;
    const behind = BEHIND * runtime.zoom;
    const k = 1 - Math.exp(-delta * 8);
    camera.rotation.order = 'XYZ';
    camera.position.x += (transform.x - camera.position.x) * k;
    camera.position.z += (transform.z - behind - camera.position.z) * k;
    const floor = groundHeight(runtime.arena, camera.position.x, camera.position.z) + GROUND_CLEARANCE;
    camera.position.y += (Math.max(transform.y + height, floor) - camera.position.y) * k;
    camera.lookAt(camera.position.x, camera.position.y - height, camera.position.z + behind);
  });
  return null;
}

/** Applies a scripted camera; false when the director passes this frame to the rig. */
function directed(director: Director, world: World, camera: PerspectiveCamera): boolean {
  const players = world.query(IsPlayer, Transform).map((entity) => {
    const t = entity.get(Transform)!;
    return {
      id: entity.get(NetId)?.id ?? '',
      x: t.x,
      y: t.y,
      z: t.z,
      yaw: t.yaw,
      bot: entity.get(Look)?.bot ?? false,
      local: entity.has(IsLocal),
      status: entity.get(Vitals)?.status ?? 'alive',
    };
  });
  const pose = director({ now: performance.now(), players });
  if (!pose) return false;
  const fov = pose.fov ?? THIRD_PERSON_FOV;
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  camera.rotation.order = 'XYZ';
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  return true;
}
