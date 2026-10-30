'use client';

import { useFrame } from '@react-three/fiber';
import { type Vec3, directionFromAngles, raycastGround, shotYaws, weaponRange, weaponStats } from '@volleyland/game-core';
import type { World } from 'koota';
import { useWorld } from 'koota/react';
import { type Camera, Vector3 } from 'three';
import { throwAngles } from '../aim';
import { stepPredictedProjectiles, syncWorld } from '../ecs/sync';
import { Anim, IsLocal, IsPlayer, PredictedProjectile, Shot, Transform } from '../ecs/traits';
import { useHud } from '../hud/hud-store';
import { type GameRuntime, useRuntime } from '../runtime';
import { faceCentre } from '../view';
import { readiness } from '../weapons';

/** Remote entities are drawn this far in the past so there are two snapshots to blend between. */
const INTERPOLATION_DELAY_MS = 100;
const MAX_INPUT_STEPS_PER_FRAME = 4;
/** Held fire waits this long past the reload (see the loop). */
const AUTO_FIRE_SLACK_MS = 40;
/** How far the third-person aim looks for the ground under the pointer. */
const AIM_REACH = 400;

const ray = new Vector3();

/** The per-frame client loop: input → prediction → reconciliation → interpolation → ECS. */
export function GameLoop() {
  const runtime = useRuntime();
  const world = useWorld();

  useFrame(({ camera }, delta) => {
    const { connection, predictor, config, metrics, pointer } = runtime;
    const joined = connection?.joined;
    if (!connection || !joined || !predictor) return;
    metrics.frames++;
    const latest = connection.snapshots.latest;
    const me = latest?.players.find((p) => p.id === joined.playerId);
    const firstPerson = runtime.view === 'first-person';

    // Reconcile the local prediction against each new authoritative snapshot.
    if (latest && me && latest.tick !== runtime.lastReconciledTick) {
      runtime.lastReconciledTick = latest.tick;
      metrics.snapshots++;
      if (me.status !== 'alive' || !predictor.position) {
        if (!predictor.position) faceCentre(runtime, me); // just joined, or a new match
        predictor.reset(me);
      } else {
        const error = predictor.reconcile(me);
        metrics.predictionError.push(error);
        if (error > 0.01) metrics.corrections++;
      }
      publishHud(latest.players, joined.playerId);
    }

    // Facing: in first person the view; in third person the way the player walks, then the pointer.
    const alive = me?.status === 'alive';
    const move = runtime.keyboard.movement(firstPerson ? pointer.look.yaw : 0);
    const position = predictor.position;
    if (firstPerson) {
      runtime.localYaw = pointer.look.yaw;
    } else {
      if (move.moveX !== 0 || move.moveZ !== 0) runtime.localYaw = Math.atan2(move.moveX, move.moveZ);
      runtime.aim.valid = pointer.ndc.over && aimAtPointer(runtime, camera);
      if (runtime.aim.valid && position) runtime.localYaw = Math.atan2(runtime.aim.x - position.x, runtime.aim.z - position.z);
    }

    // Fixed-step input: one command per inputStepMs, predicted locally with the server's own movement code.
    runtime.inputAccumulatorMs += delta * 1000;
    let steps = 0;
    while (runtime.inputAccumulatorMs >= config.inputStepMs && steps < MAX_INPUT_STEPS_PER_FRAME) {
      runtime.inputAccumulatorMs -= config.inputStepMs;
      steps++;
      if (!alive) continue;
      const seq = connection.sendInput(move.moveX, move.moveZ, runtime.localYaw);
      predictor.apply({ seq, ...move });
    }
    if (runtime.inputAccumulatorMs > config.inputStepMs * MAX_INPUT_STEPS_PER_FRAME) runtime.inputAccumulatorMs = 0;

    // Where the local player is drawn (and the first-person camera stands) this frame.
    const drawn = predictor.drawn(runtime.inputAccumulatorMs / config.inputStepMs);

    // Shots: ask the server, and show the predicted shot immediately. It leaves from the predicted
    // position (the server fires after the inputs sent before it) towards what the camera shows.
    // A click fires once; the blaster also keeps firing while the button or Space is held.
    const clicked = runtime.keyboard.throwRequested || pointer.throwRequested;
    const held = runtime.weapon === 'blaster' && (runtime.keyboard.firing || pointer.firing);
    runtime.keyboard.throwRequested = pointer.throwRequested = false;
    // A shot still reloading would only be refused by the server. Held fire waits a little past the
    // reload, so network jitter between two shots does not get the second one refused.
    const readyAt = performance.now() - (clicked ? 0 : AUTO_FIRE_SLACK_MS);
    if ((clicked || held) && alive && predictor.position && readiness(runtime, readyAt) >= 1) {
      throwFrom(runtime, world, predictor.position, drawn, firstPerson);
    }

    // Interpolate everything else at render time = estimated server time − delay.
    if (latest) {
      const renderTime = connection.clock.now(Date.now()) - INTERPOLATION_DELAY_MS;
      const sample = connection.snapshots.sample(renderTime);
      if (sample.starved) metrics.starvedFrames++;
      syncWorld(world, runtime.index, latest, sample, joined.playerId, drawn, runtime.localYaw, runtime.arena, runtime.weapon);
      if (drawn) runtime.audio?.setListener(drawn.x, drawn.z, firstPerson ? pointer.look.yaw : 0);
      for (const p of latest.players) {
        if (p.id === joined.playerId) continue;
        const shown = sample.players.get(p.id);
        if (shown) metrics.interpolationError.push(Math.hypot(shown.x - p.x, shown.z - p.z));
      }
    }
    stepPredictedProjectiles(world, delta, runtime.arena);

    const report = metrics.flush(performance.now(), runtime.dpr);
    if (report) useHud.getState().pushMetrics(report);
  });

  return null;
}

/** Third person: find the ground under the pointer. Returns whether there is any. */
function aimAtPointer(runtime: GameRuntime, camera: Camera): boolean {
  ray.set(runtime.pointer.ndc.x, runtime.pointer.ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
  const origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  const dir = { x: ray.x, y: ray.y, z: ray.z };
  const t = raycastGround(runtime.arena, origin, dir, AIM_REACH);
  if (t === null) return false;
  runtime.aim.x = origin.x + dir.x * t;
  runtime.aim.y = origin.y + dir.y * t;
  runtime.aim.z = origin.z + dir.z * t;
  return true;
}

function throwFrom(runtime: GameRuntime, world: World, position: Vec3, seenFrom: Vec3 | null, firstPerson: boolean): void {
  const { config, connection, pointer } = runtime;
  if (!connection) return;
  const others: Vec3[] = [];
  if (firstPerson) {
    world.query(IsPlayer, Transform).forEach((entity) => {
      if (entity.has(IsLocal)) return;
      const t = entity.get(Transform)!;
      others.push({ x: t.x, y: t.y, z: t.z });
    });
  }
  const { weapon } = runtime;
  const stats = weaponStats(config, weapon);
  const view = { firstPerson, yaw: runtime.localYaw, pitch: pointer.look.pitch, aim: runtime.aim.valid ? runtime.aim : null, seenFrom };
  const { yaw, pitch } = throwAngles(runtime.arena, config, position, view, others, weaponRange(stats));
  const now = performance.now();
  // One ghost per projectile, in the server's order, so each links to its own server projectile.
  const ghosts = shotYaws(yaw, stats).map((shotYaw) => {
    const dir = directionFromAngles(shotYaw, pitch);
    const muzzle = config.playerRadius + stats.radius + 0.05;
    return world.spawn(
      Transform({ x: position.x + dir.x * muzzle, y: position.y + config.projectileHeight + dir.y * muzzle, z: position.z + dir.z * muzzle, yaw: shotYaw }),
      Shot({ weapon, dx: dir.x, dy: dir.y, dz: dir.z }),
      PredictedProjectile({
        vx: dir.x * stats.speed,
        vy: dir.y * stats.speed,
        vz: dir.z * stats.speed,
        radius: stats.radius,
        expiresAt: now + stats.lifetimeMs,
        serverId: '',
        serverTick: 0,
      }),
    );
  });
  runtime.lastShotAt[weapon] = now;
  world.queryFirst(IsLocal)?.set(Anim, (anim) => ({ ...anim, throwAt: now }));
  runtime.audio?.sfx(weapon === 'ball' ? 'throw' : weapon);
  const drop = () => {
    for (const ghost of ghosts) if (world.has(ghost)) ghost.destroy();
  };
  connection.throwProjectile(yaw, pitch).then((ack) => {
    if (ack.ok) return;
    drop();
    // Refused (still reloading by the server's clock): let the next try go through.
    if (runtime.lastShotAt[weapon] === now) delete runtime.lastShotAt[weapon];
  }, drop);
}

/** Push HUD-relevant fields to Zustand only when they change, so React re-renders stay rare. */
function publishHud(players: { id: string; health: number; status: 'alive' | 'frozen' | 'dead'; protected: boolean }[], localId: string) {
  const hud = useHud.getState();
  const me = players.find((p) => p.id === localId);
  const opponents = players.filter((p) => p.id !== localId).map((p) => ({ id: p.id, health: p.health, status: p.status }));
  const opponentsChanged =
    opponents.length !== hud.opponents.length ||
    opponents.some((o, i) => o.id !== hud.opponents[i]?.id || o.health !== hud.opponents[i]?.health || o.status !== hud.opponents[i]?.status);
  if (me && (me.health !== hud.health || me.status !== hud.status || me.protected !== hud.protectedNow || opponentsChanged)) {
    hud.set({ health: me.health, status: me.status, protectedNow: me.protected, opponents });
  } else if (opponentsChanged) {
    hud.set({ opponents });
  }
}
