'use client';

import { useFrame } from '@react-three/fiber';
import { type Arena, type HeightField, PROPS, type PropKind, type WorldLayout, arenaFromLayout, heightAt, propBase } from '@volleyland/game-core';
import type { ThreeEvent } from '@react-three/fiber';
import { type ReactNode, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  type InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { decorModel } from './decor';
import { glowMaterial, propMaterial, worldUvMaterial } from './materials';
import { type Model, ball, box, cyl, modelFor, part } from './models';
import { type Placement, SCENERY_BAND, decorPlacements, sceneryPlacements } from './scatter';
import { bandGeometry, drapedRegion, floorGeometry, frameGeometry, outsideHeight, skirtGeometry } from './terrain-mesh';
import { type ThemeLook, THEME_LOOKS, type SceneryKind } from './themes';

/** How far the land round a hilly floor reaches before it is level (on the beach, the sea starts there). */
const bandOf = (look: ThemeLook) => (look.water ? WATER_BAND : look.outside ? SCENERY_BAND.far : 0);
/** Land between the floor edge and the sea, in metres. */
const WATER_BAND = 14;

export interface FloorPointerHandlers {
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerLeave?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
}

interface Props {
  layout: WorldLayout;
  /** Pointer handlers for the floor (the game turns the pointer into an aim point). */
  floor?: FloorPointerHandlers;
  /** 'low' leaves out floor decorations and particles (slow devices). */
  detail?: 'full' | 'low';
  /** Animate particles; off for people who ask for reduced motion. */
  motion?: boolean;
  /** Stretch the fog distances: a camera far above the whole world (the admin overview) needs more. */
  fogScale?: number;
  children?: ReactNode;
}

/**
 * A whole world as players see it: sky, fog and light from its theme; the floor and its painted
 * regions; props; a border; scenery round the outside; scattered decorations; ambient particles.
 * Everything that repeats is instanced or merged, so a big world costs a few dozen draw calls.
 * Shared by the game and the admin preview; it draws a layout and holds no game state.
 */
export function WorldScene({ layout, floor, detail = 'full', motion = true, fogScale = 1, children }: Props) {
  const look = THEME_LOOKS[layout.theme];
  // The same arena the game collides with: props and decorations stand on its ground.
  const arena = useMemo(() => arenaFromLayout(layout), [layout]);
  const field = arena.ground;
  return (
    <>
      <color attach="background" args={[look.sky]} />
      <fog attach="fog" args={[look.fog.color, look.fog.near * fogScale, look.fog.far * fogScale]} />
      <hemisphereLight args={[look.hemisphere.sky, look.hemisphere.ground, look.hemisphere.intensity]} />
      <directionalLight position={[18, 30, -10]} color={look.sun.color} intensity={look.sun.intensity} />
      {field ? <TerrainGround layout={layout} look={look} field={field} handlers={floor} /> : <Ground layout={layout} look={look} handlers={floor} />}
      {field ? <DrapedRegions layout={layout} field={field} /> : <Regions layout={layout} />}
      <Border layout={layout} look={look} />
      <PropMeshes layout={layout} look={look} field={field} />
      <Scenery layout={layout} look={look} />
      {detail === 'full' && <Decor layout={layout} look={look} arena={arena} />}
      {detail === 'full' && look.particles && <AmbientParticles kind={look.particles} layout={layout} field={field} motion={motion} />}
      {look.stars && <StarField />}
      {children}
    </>
  );
}

/* ---------- ground ---------- */

function Ground({ layout, look, handlers }: { layout: WorldLayout; look: ThemeLook; handlers?: FloorPointerHandlers }) {
  const { halfWidth: hw, halfDepth: hd } = layout;
  const outside = look.outside;
  const reach = SCENERY_BAND.far + 40;
  const water = useMemo(() => (look.water ? new MeshLambertMaterial({ color: look.water, emissive: look.water, emissiveIntensity: 0.15 }) : null), [look.water]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} material={worldUvMaterial(layout.floor)} {...handlers}>
        <planeGeometry args={[hw * 2, hd * 2]} />
      </mesh>
      {outside && (
        <mesh rotation-x={-Math.PI / 2} position-y={-0.04} material={worldUvMaterial(outside.surface, outside.tint)}>
          <planeGeometry args={[(hw + (water ? 14 : reach)) * 2, (hd + (water ? 14 : reach)) * 2]} />
        </mesh>
      )}
      {water && (
        <mesh rotation-x={-Math.PI / 2} position-y={-0.12} material={water}>
          <planeGeometry args={[(hw + reach * 3) * 2, (hd + reach * 3) * 2]} />
        </mesh>
      )}
    </group>
  );
}

/** Painted regions, one merged mesh per surface; later regions sit a hair above earlier ones. */
function Regions({ layout }: { layout: WorldLayout }) {
  const meshes = useMemo(() => {
    const bySurface = new Map<string, BufferGeometry[]>();
    layout.regions.forEach((r, i) => {
      const g = r.shape === 'rect' ? new PlaneGeometry(r.width, r.depth) : new CircleGeometry(0.5, 40).scale(r.width, r.depth, 1);
      g.rotateX(-Math.PI / 2);
      g.rotateY((r.rotation * Math.PI) / 180);
      g.translate(r.x, 0.004 + i * 0.002, r.z);
      g.deleteAttribute('uv');
      const list = bySurface.get(r.surface) ?? [];
      list.push(g.index ? g.toNonIndexed() : g);
      bySurface.set(r.surface, list);
    });
    return [...bySurface].map(([surface, parts]) => ({ surface, geometry: mergeGeometries(parts)! }));
  }, [layout.regions]);
  useLayoutEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes]);
  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.surface} geometry={m.geometry} material={worldUvMaterial(m.surface as Parameters<typeof worldUvMaterial>[0])} />
      ))}
    </group>
  );
}

/**
 * Hilly ground: the floor mesh, a band of land round it easing down to level, then flat ground
 * (or the sea) beyond. A world floating in space has sides instead.
 */
function TerrainGround({ layout, look, field, handlers }: { layout: WorldLayout; look: ThemeLook; field: HeightField; handlers?: FloorPointerHandlers }) {
  const parts = useMemo(() => {
    const reach = SCENERY_BAND.far + 40;
    const floor = floorGeometry(field);
    const band = look.outside ? bandGeometry(layout, field, bandOf(look)) : null;
    const inner = band ?? { halfWidth: layout.halfWidth, halfDepth: layout.halfDepth };
    const level = look.outside && !look.water ? frameGeometry(inner, { halfWidth: layout.halfWidth + reach, halfDepth: layout.halfDepth + reach }, 0) : null;
    const sea = look.water ? frameGeometry(inner, { halfWidth: layout.halfWidth + reach * 3, halfDepth: layout.halfDepth + reach * 3 }, -0.12) : null;
    const sides = look.outside ? null : skirtGeometry(field, Math.min(0, field.min) - 2.5);
    return { floor, band: band?.geometry ?? null, level, sea, sides };
  }, [layout, field, look]);
  useLayoutEffect(() => () => Object.values(parts).forEach((g) => g?.dispose()), [parts]);
  const water = useMemo(() => (look.water ? new MeshLambertMaterial({ color: look.water, emissive: look.water, emissiveIntensity: 0.15 }) : null), [look.water]);
  const outside = look.outside;
  return (
    <group>
      <mesh geometry={parts.floor} material={worldUvMaterial(layout.floor)} {...handlers} />
      {outside && parts.band && <mesh geometry={parts.band} material={worldUvMaterial(outside.surface, outside.tint)} />}
      {outside && parts.level && <mesh geometry={parts.level} material={worldUvMaterial(outside.surface, outside.tint)} />}
      {water && parts.sea && <mesh geometry={parts.sea} material={water} />}
      {parts.sides && <mesh geometry={parts.sides} material={worldUvMaterial(layout.floor, '#5a6270', { doubleSided: true })} />}
    </group>
  );
}

/** Painted regions draped over hilly ground, one merged mesh per surface; later regions sit a hair above earlier ones. */
function DrapedRegions({ layout, field }: { layout: WorldLayout; field: HeightField }) {
  const meshes = useMemo(() => {
    const bySurface = new Map<string, BufferGeometry[]>();
    layout.regions.forEach((r, i) => {
      const list = bySurface.get(r.surface) ?? [];
      list.push(drapedRegion(r, field, 0.02 + i * 0.003));
      bySurface.set(r.surface, list);
    });
    return [...bySurface].map(([surface, parts]) => ({ surface, geometry: mergeGeometries(parts)! }));
  }, [layout.regions, field]);
  useLayoutEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes]);
  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.surface} geometry={m.geometry} material={worldUvMaterial(m.surface as Parameters<typeof worldUvMaterial>[0], '#ffffff', { decal: true })} />
      ))}
    </group>
  );
}

/* ---------- border ---------- */

function Border({ layout, look }: { layout: WorldLayout; look: ThemeLook }) {
  const { solid, glow } = useMemo(
    () => buildBorder(layout.halfWidth, layout.halfDepth, look, layout.terrain || layout.hills?.length ? outsideHeight(layout, bandOf(look) || 1) : null),
    [layout, look],
  );
  useLayoutEffect(() => () => [solid, glow].forEach((g) => g?.dispose()), [solid, glow]);
  return (
    <group>
      {solid && <mesh geometry={solid} material={propMaterial()} />}
      {glow && <mesh geometry={glow} material={glowMaterial()} />}
    </group>
  );
}

/**
 * The floor's edging: a curb, posts and rails from the theme. On hilly ground (`ground` given) the
 * curb is laid in short pieces and the rails run post to post, each following the ground.
 */
function buildBorder(hw: number, hd: number, look: ThemeLook, ground: ((x: number, z: number) => number) | null): { solid: BufferGeometry | null; glow: BufferGeometry | null } {
  const { curb, posts, rails } = look.border;
  const solid: BufferGeometry[] = [];
  const glow: BufferGeometry[] = [];
  const edge = 0.3; // just outside the floor edge
  const ow = hw + edge;
  const od = hd + edge;
  const h = ground ?? (() => 0);
  /** Points along each side, `spacing` apart, corners included: [x, z] pairs running along x (front, back) or z (sides). */
  const sides = (spacing: number) => {
    const along = (length: number) => Math.max(2, Math.round(length / spacing));
    const nx = along(ow * 2);
    const nz = along(od * 2);
    const xs = Array.from({ length: nx + 1 }, (_, i) => -ow + (i / nx) * ow * 2);
    const zs = Array.from({ length: nz + 1 }, (_, i) => -od + (i / nz) * od * 2);
    return [
      { axis: 'x' as const, points: xs.map((x) => [x, od] as const) },
      { axis: 'x' as const, points: xs.map((x) => [x, -od] as const) },
      { axis: 'z' as const, points: zs.map((z) => [ow, z] as const) },
      { axis: 'z' as const, points: zs.map((z) => [-ow, z] as const) },
    ];
  };
  if (curb) {
    const w = curb.width;
    if (!ground) {
      solid.push(box((ow + w / 2) * 2, curb.height, w, curb.color, { z: od }), box((ow + w / 2) * 2, curb.height, w, curb.color, { z: -od }));
      solid.push(box(w, curb.height, od * 2, curb.color, { x: ow }), box(w, curb.height, od * 2, curb.color, { x: -ow }));
    } else {
      // Short pieces, each reaching from below the lower end to a curb's height above the higher one.
      for (const side of sides(2)) {
        for (let i = 0; i < side.points.length - 1; i++) {
          const [x0, z0] = side.points[i]!;
          const [x1, z1] = side.points[i + 1]!;
          const y0 = h(x0, z0);
          const y1 = h(x1, z1);
          const low = Math.min(y0, y1) - 0.25;
          const tall = Math.max(y0, y1) - low + curb.height;
          const len = Math.hypot(x1 - x0, z1 - z0) + w;
          const at = { x: (x0 + x1) / 2, y: low, z: (z0 + z1) / 2 };
          solid.push(side.axis === 'x' ? box(len, tall, w, curb.color, at) : box(w, tall, len, curb.color, at));
        }
      }
    }
  }
  if (posts) {
    const add = (x: number, z: number) => {
      const y = h(x, z);
      if (posts.shape === 'box') solid.push(box(posts.width, posts.height, posts.width, posts.color, { x, y, z }));
      else if (posts.shape === 'round') solid.push(cyl(posts.width / 2, posts.height, posts.color, { x, y, z }, 6));
      else solid.push(part(new SphereGeometry(posts.width / 2, 8, 5), posts.color, { x, y, z, sy: (posts.height * 2) / posts.width }));
    };
    const seen = new Set<string>();
    for (const side of sides(posts.spacing)) {
      for (const [x, z] of side.points) {
        const key = `${x.toFixed(3)},${z.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        add(x, z);
      }
    }
  }
  if (rails) {
    const t = rails.thickness;
    const list = rails.glow ? glow : solid;
    if (!ground) {
      for (const height of rails.heights) {
        list.push(box(ow * 2, t, t, rails.color, { y: height - t / 2, z: od }), box(ow * 2, t, t, rails.color, { y: height - t / 2, z: -od }));
        list.push(box(t, t, od * 2, rails.color, { y: height - t / 2, x: ow }), box(t, t, od * 2, rails.color, { y: height - t / 2, x: -ow }));
      }
    } else {
      // Rail lengths run post to post, tilted with the ground between them.
      for (const side of sides(posts?.spacing ?? 3)) {
        for (let i = 0; i < side.points.length - 1; i++) {
          const [x0, z0] = side.points[i]!;
          const [x1, z1] = side.points[i + 1]!;
          const y0 = h(x0, z0);
          const y1 = h(x1, z1);
          const run = Math.hypot(x1 - x0, z1 - z0);
          const len = Math.hypot(run, y1 - y0);
          const tilt = Math.atan2(y1 - y0, run);
          for (const height of rails.heights) {
            const at = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + height - t / 2, z: (z0 + z1) / 2 };
            list.push(side.axis === 'x' ? part(new BoxGeometry(len, t, t), rails.color, { ...at, rz: tilt }) : part(new BoxGeometry(t, t, len), rails.color, { ...at, rx: -tilt }));
          }
        }
      }
    }
  }
  return { solid: solid.length > 0 ? mergeGeometries(solid) : null, glow: glow.length > 0 ? mergeGeometries(glow) : null };
}

/* ---------- instanced models ---------- */

const tmpMatrix = new Matrix4();
const tmpPosition = new Vector3();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();
const UP = new Vector3(0, 1, 0);
const tmpColor = new Color();

/** Draw many copies of one model: up to three instanced meshes (toon, faced, glow). */
function InstancedModel({ model, placements, facing }: { model: Model; placements: readonly Placement[]; facing?: Parameters<typeof worldUvMaterial>[0] }) {
  const solid = useRef<InstancedMesh>(null);
  const faced = useRef<InstancedMesh>(null);
  const glow = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    for (const mesh of [solid.current, faced.current, glow.current]) {
      if (!mesh) continue;
      placements.forEach((p, i) => {
        tmpPosition.set(p.x, p.y, p.z);
        tmpQuat.setFromAxisAngle(UP, p.yaw);
        tmpScale.set(p.sx, p.sy, p.sz);
        mesh.setMatrixAt(i, tmpMatrix.compose(tmpPosition, tmpQuat, tmpScale));
        if (mesh === solid.current) mesh.setColorAt(i, tmpColor.set(model.tints[p.tint % model.tints.length]!));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [model, placements]);
  const n = placements.length;
  if (n === 0) return null;
  return (
    <group>
      {model.solid && <instancedMesh key={`s${n}`} ref={solid} args={[model.solid, propMaterial(), n]} />}
      {model.faced && facing && <instancedMesh key={`f${n}`} ref={faced} args={[model.faced, worldUvMaterial(facing), n]} />}
      {model.glow && <instancedMesh key={`g${n}`} ref={glow} args={[model.glow, glowMaterial(), n]} />}
    </group>
  );
}

const propSeed = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0) % 997;

function PropMeshes({ layout, look, field }: { layout: WorldLayout; look: ThemeLook; field: HeightField | null }) {
  const groups = useMemo(() => {
    const byKind = new Map<PropKind, Placement[]>();
    layout.props.forEach((p, i) => {
      const list = byKind.get(p.kind) ?? [];
      const round = PROPS[p.kind].shape === 'circle';
      // Stood where collision stands it: on the lowest ground under its foot.
      list.push({ x: p.x, y: propBase(field, p), z: p.z, yaw: (p.rotation * Math.PI) / 180, sx: p.width, sy: p.height, sz: round ? p.width : p.depth, tint: propSeed(i) });
      byKind.set(p.kind, list);
    });
    return [...byKind];
  }, [layout.props, field]);
  const shadows = useMemo(() => groups.flatMap(([kind, list]) => list.map((p) => ({ ...p, sx: p.sx * 1.25 + 0.3, sz: p.sz * 1.25 + 0.3, round: PROPS[kind].shape === 'circle' }))), [groups]);
  return (
    <group>
      <ShadowBlobs placements={shadows} />
      {groups.map(([kind, list]) => (
        <InstancedModel key={kind} model={modelFor(kind)} placements={list} facing={kind === 'wall' ? look.facings.wall : look.facings.block} />
      ))}
    </group>
  );
}

let blob: { geometry: PlaneGeometry; material: MeshBasicMaterial } | null = null;
function blobAssets() {
  if (!blob) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    blob = {
      geometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.012, 0),
      material: new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }),
    };
  }
  return blob;
}

/** Soft contact shadows under props (no shadow maps). */
function ShadowBlobs({ placements }: { placements: readonly Placement[] }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    placements.forEach((p, i) => {
      tmpPosition.set(p.x, p.y, p.z);
      tmpQuat.setFromAxisAngle(UP, p.yaw);
      tmpScale.set(p.sx, 1, p.sz);
      mesh.setMatrixAt(i, tmpMatrix.compose(tmpPosition, tmpQuat, tmpScale));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements]);
  if (placements.length === 0) return null;
  const { geometry, material } = blobAssets();
  return <instancedMesh key={placements.length} ref={ref} args={[geometry, material, placements.length]} renderOrder={1} />;
}

/* ---------- scenery and decorations ---------- */

const isPropKind = (kind: SceneryKind): kind is PropKind => kind in PROPS;

function Scenery({ layout, look }: { layout: WorldLayout; look: ThemeLook }) {
  const groups = useMemo(
    () => [...sceneryPlacements(layout, look.scenery.kinds, look.scenery.density, layout.terrain || layout.hills?.length ? outsideHeight(layout, bandOf(look)) : undefined)],
    [layout, look],
  );
  return (
    <group>
      {groups.map(([kind, list]) => {
        if (!isPropKind(kind)) return <InstancedModel key={kind} model={decorModel(kind)} placements={list} />;
        // Prop models are unit-sized: scale them to the catalogue size.
        const { width, depth, height } = PROPS[kind].size;
        const sized = list.map((p) => ({ ...p, sx: p.sx * width, sy: p.sy * height, sz: p.sz * (PROPS[kind].shape === 'circle' ? width : depth) }));
        return <InstancedModel key={kind} model={modelFor(kind)} placements={sized} facing={look.facings.block} />;
      })}
    </group>
  );
}

function Decor({ layout, look, arena }: { layout: WorldLayout; look: ThemeLook; arena: Arena }) {
  const groups = useMemo(() => [...decorPlacements(layout, arena, look.decor)], [layout, arena, look]);
  return (
    <group>
      {groups.map(([kind, list]) => (
        <InstancedModel key={kind} model={decorModel(kind)} placements={list} />
      ))}
    </group>
  );
}

/* ---------- particles and sky ---------- */

const PARTICLE_COUNT = 600;
const ahead = new Vector3();
const PARTICLE_STYLE = {
  snow: { color: '#ffffff', size: 0.16, fall: 1.2, drift: 0.4, height: 14 },
  leaves: { color: '#f4a261', size: 0.14, fall: 0.6, drift: 0.9, height: 9 },
  dust: { color: '#ffe2a8', size: 0.07, fall: -0.05, drift: 0.15, height: 5 },
} as const;

let dot: CanvasTexture | null = null;
function dotTexture(): CanvasTexture {
  if (!dot) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    dot = new CanvasTexture(canvas);
  }
  return dot;
}

/** Snow, falling leaves or floating dust in a box that follows the camera. */
function AmbientParticles({ kind, layout, field, motion }: { kind: keyof typeof PARTICLE_STYLE; layout: WorldLayout; field: HeightField | null; motion: boolean }) {
  const style = PARTICLE_STYLE[kind];
  const points = useRef<Points>(null);
  const span = 60;
  const { geometry, material, seeds } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const seeds = new Float32Array(PARTICLE_COUNT);
    let s = 1;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions.set([(r() - 0.5) * span, r() * style.height, (r() - 0.5) * span], i * 3);
      seeds[i] = r() * 100;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = new PointsMaterial({ color: style.color, size: style.size, map: dotTexture(), transparent: true, depthWrite: false, sizeAttenuation: true });
    return { geometry, material, seeds };
  }, [style]);
  useLayoutEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  useFrame(({ camera, clock }, delta) => {
    const p = points.current;
    if (!p) return;
    // Keep the box centred a little ahead of the camera (whichever way it looks), within the world, on the ground there.
    camera.getWorldDirection(ahead);
    const flat = Math.hypot(ahead.x, ahead.z) || 1;
    const cx = Math.max(-layout.halfWidth, Math.min(layout.halfWidth, camera.position.x + (ahead.x / flat) * 12));
    const cz = Math.max(-layout.halfDepth, Math.min(layout.halfDepth, camera.position.z + (ahead.z / flat) * 12));
    p.position.set(cx, heightAt(field, cx, cz), cz);
    if (!motion) return;
    const pos = geometry.getAttribute('position') as BufferAttribute;
    const arr = pos.array as Float32Array;
    const t = clock.elapsedTime;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const k = i * 3;
      arr[k + 1]! -= style.fall * delta;
      arr[k]! += Math.sin(t * 0.8 + seeds[i]!) * style.drift * delta;
      arr[k + 2]! += Math.cos(t * 0.6 + seeds[i]!) * style.drift * delta;
      if (arr[k + 1]! < 0) arr[k + 1] = style.height;
      if (arr[k + 1]! > style.height) arr[k + 1] = 0;
    }
    pos.needsUpdate = true;
  });
  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}

/** Stars all round and a planet below the horizon, for worlds floating in space. */
function StarField() {
  const { geometry, material, planet } = useMemo(() => {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const u = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const rad = 400;
      const h = Math.sqrt(1 - u * u);
      positions.set([Math.cos(a) * h * rad, u * rad * 0.6 - 60, Math.sin(a) * h * rad], i * 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = new PointsMaterial({ color: '#dfe9ff', size: 1.6, map: dotTexture(), transparent: true, depthWrite: false, fog: false });
    const planet = mergeGeometries([ball(60, '#3d5a99', {}, 3), part(new SphereGeometry(95, 40, 8), '#6b8fd6', { sy: 0.012 })]);
    return { geometry, material, planet };
  }, []);
  useLayoutEffect(() => () => {
    geometry.dispose();
    material.dispose();
    planet?.dispose();
  }, [geometry, material, planet]);
  return (
    <group>
      <points geometry={geometry} material={material} frustumCulled={false} />
      {planet && <mesh geometry={planet} material={glowMaterial()} position={[-160, -120, 260]} />}
    </group>
  );
}
