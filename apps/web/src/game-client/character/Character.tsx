'use client';

import { useFrame } from '@react-three/fiber';
import { type AppearanceSettings, lookOf } from '@volleyland/game-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, type Group, type Mesh, type Sprite } from 'three';
import { bodyGeometry, bodyMaterial, detailGeometry, gunGeometry, iceGeometry, labelMaterial, proportions, ringGeometry, shadowGeometry, sharedAssets } from './assets';
import { type CharacterFrame, newMotionState, stepPose } from './motion';

export interface CharacterProps {
  appearance: AppearanceSettings;
  /** Appearance slot from the server: picks colour and accessory. */
  look: number;
  bot: boolean;
  isLocal: boolean;
  label: string;
  radius: number;
  height: number;
  maxHealth: number;
  /** Full running speed, for scaling the gait. */
  runSpeed: number;
  /** Fill `out` with this frame's state; return false to hide the character. */
  sample: (out: CharacterFrame) => boolean;
}

const ICE = new Color('#d7f0ff');
const BAR_WIDTH = 1;
const BAR_HEIGHT = 0.12;
const LABEL_HEIGHT = 0.46;
/** Guns are modelled at hand size; on a character seen from above and behind they are drawn bigger to read. */
const GUN_SCALE = 1.8;

/** Honour the OS "reduce motion" setting: it overrides the animation strength. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * A player character: toon-shaded body and head, eyes and an accessory (or a bot's visor and
 * antenna), with procedural animation. Two meshes for the character itself plus small extras
 * (shadow, rings, label, health bar), all from shared geometry; per-frame work only writes
 * transforms to refs, never React state.
 */
export function Character({ appearance, look, bot, isLocal, label, radius, height, maxHealth, runSpeed, sample }: CharacterProps) {
  const reducedMotion = usePrefersReducedMotion();
  const p = useMemo(() => proportions(radius, height), [radius, height]);
  const { color, accessory } = lookOf(look, appearance.palette);
  const marker = bot && appearance.botMarker;
  const assets = sharedAssets();

  const body = useMemo(() => bodyGeometry(p), [p]);
  const details = useMemo(() => detailGeometry(p, { bot: marker, accessory: appearance.accessories ? accessory : null }), [p, marker, appearance.accessories, accessory]);
  const material = useMemo(() => bodyMaterial(color), [color]);
  useEffect(() => () => material.dispose(), [material]);
  const baseColor = useMemo(() => new Color(color), [color]);
  const tag = useMemo(() => labelMaterial(label), [label]);

  const root = useRef<Group>(null);
  const rig = useRef<Group>(null);
  const overhead = useRef<Group>(null);
  const ice = useRef<Mesh>(null);
  const gun = useRef<Mesh>(null);
  const shadow = useRef<Mesh>(null);
  const ownRing = useRef<Mesh>(null);
  const shield = useRef<Mesh>(null);
  const labelSprite = useRef<Sprite>(null);
  const barBack = useRef<Sprite>(null);
  const barFill = useRef<Sprite>(null);
  const motion = useRef(newMotionState());
  const frame = useRef<CharacterFrame>({ x: 0, y: 0, z: 0, yaw: 0, status: 'alive', protected: false, health: maxHealth, throwAt: -1e9, hitAt: -1e9 });

  useFrame((_, delta) => {
    if (!root.current || !rig.current || !overhead.current) return;
    const f = frame.current;
    const shown = sample(f);
    root.current.visible = overhead.current.visible = shown;
    if (!shown) return;

    const now = performance.now();
    const pose = stepPose(motion.current, f, delta, now, reducedMotion ? 0 : appearance.animation, runSpeed);

    root.current.position.set(f.x, f.y, f.z);
    root.current.rotation.y = f.yaw;
    rig.current.visible = pose.visible;
    rig.current.position.set(0, pose.bob, pose.lunge);
    rig.current.rotation.set(pose.leanX, pose.spin, pose.leanZ);
    rig.current.scale.set(pose.scaleXZ * pose.size, pose.scaleY * pose.size, pose.scaleXZ * pose.size);

    material.color.copy(baseColor).lerp(ICE, pose.frost * 0.55);
    material.emissive.setScalar(pose.flash * 0.7);
    if (gun.current) {
      const geometry = f.weapon ? gunGeometry(f.weapon) : null;
      gun.current.visible = geometry !== null && f.status !== 'dead';
      if (geometry && gun.current.geometry !== geometry) gun.current.geometry = geometry;
    }
    if (ice.current) {
      ice.current.visible = pose.frost > 0.04;
      ice.current.scale.setScalar(0.55 + 0.45 * pose.frost);
    }
    if (shadow.current) {
      shadow.current.visible = appearance.blobShadows && pose.visible;
      shadow.current.scale.setScalar(Math.max(0.2, (1 - pose.bob * 1.6) * pose.size));
    }
    if (ownRing.current) ownRing.current.visible = isLocal && pose.visible;
    if (shield.current) {
      shield.current.visible = f.protected && f.status === 'alive';
      shield.current.scale.setScalar(1 + 0.08 * Math.sin(now / 160));
    }

    // Overhead items face the camera (sprites) and do not turn with the character.
    overhead.current.position.set(f.x, f.y + height + pose.bob, f.z);
    const up = f.status !== 'dead' && pose.visible;
    if (labelSprite.current) labelSprite.current.visible = appearance.nameTags && up;
    const bars = appearance.healthBars === 'everyone' || (appearance.healthBars === 'opponents' && !isLocal);
    if (barBack.current && barFill.current) {
      barBack.current.visible = barFill.current.visible = bars && up;
      const fraction = Math.max(0, Math.min(1, f.health / maxHealth));
      barFill.current.scale.set(Math.max(BAR_WIDTH * fraction, 0.001), BAR_HEIGHT, 1);
      barFill.current.material = fraction > 0.5 ? assets.barFill.good : fraction > 0.25 ? assets.barFill.warn : assets.barFill.low;
    }
  });

  return (
    <>
      <group ref={root}>
        <mesh ref={shadow} geometry={shadowGeometry(radius)} material={assets.shadow} position-y={0.015} renderOrder={1} />
        <mesh ref={ownRing} geometry={ringGeometry(radius)} material={assets.ownRing} position-y={0.02} visible={false} />
        <mesh ref={shield} geometry={ringGeometry(radius * 1.15)} material={assets.shield} position-y={0.03} visible={false} />
        <group ref={rig}>
          <mesh geometry={body} material={material} />
          <mesh geometry={details} material={assets.details} />
          {/* Held at the right side (screen right from behind is −x), pointing the way the character faces. */}
          <mesh ref={gun} material={assets.details} position={[-p.torsoR * 1.05, p.torsoY, p.torsoR * 0.5]} scale={GUN_SCALE} visible={false} />
          <mesh ref={ice} geometry={iceGeometry(radius, height)} material={assets.ice} position-y={height * 0.5} visible={false} />
        </group>
      </group>
      <group ref={overhead}>
        <sprite ref={labelSprite} material={tag.material} position-y={0.85} scale={[LABEL_HEIGHT * tag.aspect, LABEL_HEIGHT, 1]} />
        <sprite ref={barBack} material={assets.barBack} position-y={0.4} scale={[BAR_WIDTH + 0.06, BAR_HEIGHT + 0.06, 1]} />
        {/* Anchored at its screen-left end: the camera looks along +z, so screen-left is world +x. */}
        <sprite ref={barFill} material={assets.barFill.good} position={[BAR_WIDTH / 2, 0.4, 0]} center={[0, 0.5]} scale={[BAR_WIDTH, BAR_HEIGHT, 1]} />
      </group>
    </>
  );
}
