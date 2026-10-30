'use client';

import type { WorldLayoutDto } from '@volleyland/contracts';
import { type CheckResult, PROPS, type PropKind, type SurfaceId, buildHeightField, heightAt } from '@volleyland/game-core';
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { textureBase } from '@/game-client/world/textures';
import { THEME_LOOKS } from '@/game-client/world/themes';
import styles from '../admin.module.css';
import { type ItemRef, type Selection, itemsIn, keyOf, moveItems, normalizeDegrees, refsOf, round, select, updateItem } from './editing';

/** What a click on empty floor does: place a prop, paint a region, raise a hill (or sink a hollow) or add a spawn point. */
export type Tool = { kind: 'prop'; prop: PropKind } | { kind: 'region'; shape: 'rect' | 'ellipse'; surface: SurfaceId } | { kind: 'hill'; height: number } | { kind: 'spawn' };

interface Props {
  layout: WorldLayoutDto;
  selection: Selection;
  invalid: ReadonlySet<string>;
  checks: CheckResult | null;
  tool: Tool | null;
  snap: number;
  lowCoverHeight: number;
  onSelect: (selection: Selection) => void;
  /** A drag or handle gesture is starting: remember the layout for undo. */
  onGestureStart: () => void;
  /** The layout during a gesture (not a new undo step each move). */
  onChange: (layout: WorldLayoutDto) => void;
  onPlace: (x: number, z: number) => void;
}

type Gesture =
  | { kind: 'move'; refs: ItemRef[]; from: WorldLayoutDto; startX: number; startZ: number }
  | { kind: 'rotate'; ref: ItemRef; from: WorldLayoutDto }
  | { kind: 'resize'; ref: ItemRef; from: WorldLayoutDto }
  | { kind: 'box'; startX: number; startZ: number; x: number; z: number; additive: boolean }
  | { kind: 'pan'; clientX: number; clientY: number; cx: number; cz: number };

const PAD = 3;
const SPAWN_RADIUS = 0.8;

/**
 * The world from above, oriented the way players see it (+z up, +x to the left, because the game
 * camera looks along +z). Drag items to move them, drag empty floor to box-select, drag the round
 * handle to turn and the square handle to resize. Wheel zooms at the pointer; drag with the middle
 * button, or with Space held, to pan.
 */
export function PlanView({ layout, selection, invalid, checks, tool, snap, lowCoverHeight, onSelect, onGestureStart, onChange, onPlace }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const { halfWidth: hw, halfDepth: hd } = layout;
  const fit = useMemo(() => ({ cx: 0, cz: 0, span: Math.max(hw, hd) * 2 + PAD * 2 }), [hw, hd]);
  const [view, setView] = useState(fit);
  useEffect(() => setView(fit), [fit]);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const spaceHeld = useRef(false);
  const look = THEME_LOOKS[layout.theme];

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) spaceHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Wheel zoom at the pointer. A native listener, so it can prevent the page from scrolling.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = toFloor(el, e.clientX, e.clientY);
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const span = Math.min(fit.span * 1.5, Math.max(6, v.span * factor));
        const k = span / v.span;
        return { span, cx: at.x + (v.cx - at.x) * k, cz: at.z + (v.cz - at.z) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fit.span]);

  const snapped = (v: number) => (snap > 0 ? round(v, snap) : round(v, 0.01));

  const startItem = (ref: ItemRef, e: ReactPointerEvent) => {
    if (e.button !== 0 || tool || spaceHeld.current) return;
    e.stopPropagation();
    const key = keyOf(ref);
    let next = selection;
    if (e.shiftKey) {
      const toggled = new Set(selection);
      if (toggled.has(key)) toggled.delete(key);
      else toggled.add(key);
      onSelect(toggled);
      return;
    }
    if (!selection.has(key)) {
      next = select(ref);
      onSelect(next);
    }
    const at = toFloor(svg.current!, e.clientX, e.clientY);
    svg.current!.setPointerCapture(e.pointerId);
    onGestureStart();
    setGesture({ kind: 'move', refs: refsOf(next), from: layout, startX: at.x, startZ: at.z });
  };

  const startHandle = (kind: 'rotate' | 'resize', ref: ItemRef, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    svg.current!.setPointerCapture(e.pointerId);
    onGestureStart();
    setGesture({ kind, ref, from: layout });
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const at = toFloor(svg.current!, e.clientX, e.clientY);
    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      e.preventDefault();
      svg.current!.setPointerCapture(e.pointerId);
      setGesture({ kind: 'pan', clientX: e.clientX, clientY: e.clientY, cx: view.cx, cz: view.cz });
      return;
    }
    if (e.button !== 0) return;
    if (tool) {
      if (Math.abs(at.x) <= hw && Math.abs(at.z) <= hd) onPlace(snapped(at.x), snapped(at.z));
      return;
    }
    svg.current!.setPointerCapture(e.pointerId);
    setGesture({ kind: 'box', startX: at.x, startZ: at.z, x: at.x, z: at.z, additive: e.shiftKey });
    if (!e.shiftKey) onSelect(new Set());
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const at = toFloor(svg.current!, e.clientX, e.clientY);
    setHover(at);
    if (!gesture) return;
    if (gesture.kind === 'pan') {
      // The view box is fitted inside the element ("meet"): metres per screen pixel.
      const rect = svg.current!.getBoundingClientRect();
      const perPixel = 1 / Math.min(rect.width / view.span, rect.height / (view.span / fitAspect(hw, hd)));
      setView((v) => ({ ...v, cx: gesture.cx + (e.clientX - gesture.clientX) * perPixel, cz: gesture.cz + (e.clientY - gesture.clientY) * perPixel }));
    } else if (gesture.kind === 'box') {
      setGesture({ ...gesture, x: at.x, z: at.z });
    } else if (gesture.kind === 'move') {
      onChange(moveItems(gesture.from, gesture.refs, at.x - gesture.startX, at.z - gesture.startZ, snap));
    } else if (gesture.kind === 'rotate') {
      const item = itemAt(gesture.from, gesture.ref);
      // Handle sits on the item's local +z side, so the angle to the pointer is the new turn.
      const angle = (Math.atan2(at.x - item.x, at.z - item.z) * 180) / Math.PI;
      const step = e.shiftKey ? 1 : 15;
      onChange(updateItem(gesture.from, gesture.ref, { rotation: normalizeDegrees(Math.round(angle / step) * step) }));
    } else if (gesture.kind === 'resize') {
      const item = itemAt(gesture.from, gesture.ref) as { x: number; z: number; rotation: number; kind?: PropKind };
      const a = (item.rotation * Math.PI) / 180;
      const dx = at.x - item.x;
      const dz = at.z - item.z;
      const lx = dx * Math.cos(a) - dz * Math.sin(a);
      const lz = dx * Math.sin(a) + dz * Math.cos(a);
      const step = snap > 0 ? snap : 0.1;
      const size = (v: number) => Math.max({ prop: 0.2, region: 0.5, hill: 2, spawn: 0 }[gesture.ref.kind], round(Math.abs(v) * 2, step));
      const isRound = gesture.ref.kind === 'prop' && item.kind !== undefined && PROPS[item.kind].shape === 'circle';
      const patch = isRound ? { width: size(Math.hypot(lx, lz)) } : { width: size(lx), depth: size(lz) };
      onChange(updateItem(gesture.from, gesture.ref, patch));
    }
  };

  const onPointerUp = () => {
    if (gesture?.kind === 'box') {
      const minX = Math.min(gesture.startX, gesture.x);
      const maxX = Math.max(gesture.startX, gesture.x);
      const minZ = Math.min(gesture.startZ, gesture.z);
      const maxZ = Math.max(gesture.startZ, gesture.z);
      if (maxX - minX > 0.2 || maxZ - minZ > 0.2) {
        const picked = itemsIn(layout, minX, minZ, maxX, maxZ).map(keyOf);
        onSelect(new Set([...(gesture.additive ? selection : []), ...picked]));
      }
    }
    setGesture(null);
  };

  // Light and shadow over hilly ground, redrawn when the ground changes (not while dragging props).
  const shade = useMemo(() => hillShadeUrl(layout), [layout.halfWidth, layout.halfDepth, layout.terrain, layout.hills]);
  const single = selection.size === 1 ? refsOf(selection)[0]! : null;
  const handleRef = single && single.kind !== 'spawn' ? single : null;
  const w = view.span;
  const h = view.span / fitAspect(hw, hd);
  const majorStep = view.span > 120 ? 10 : 5;
  const grid: number[] = [];
  for (let v = -Math.floor(Math.max(hw, hd) / majorStep) * majorStep; v <= Math.max(hw, hd); v += majorStep) grid.push(v);
  const stroke = view.span / 600;

  return (
    <svg
      ref={svg}
      className={styles.plan}
      data-tool={tool ? tool.kind : undefined}
      data-panning={gesture?.kind === 'pan' || undefined}
      viewBox={`${-view.cx - w / 2} ${-view.cz - h / 2} ${w} ${h}`}
      role="application"
      aria-label={`Floor plan, ${2 * hw} by ${2 * hd} metres. ${layout.props.length} props, ${layout.spawnPoints.length} spawn points.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setGesture(null)}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <rect x={-hw} y={-hd} width={2 * hw} height={2 * hd} fill={textureBase(layout.floor)} />
      {layout.regions.map((r, i) => {
        const key = keyOf({ kind: 'region', index: i });
        const selected = selection.has(key);
        return (
          <g
            key={key}
            transform={`translate(${-r.x} ${-r.z}) rotate(${-r.rotation})`}
            className={styles.planRegion}
            data-selected={selected || undefined}
            data-invalid={invalid.has(key) || undefined}
            onPointerDown={(e) => startItem({ kind: 'region', index: i }, e)}
          >
            <title>{`Floor patch ${i + 1}: ${r.surface}`}</title>
            {r.shape === 'rect' ? (
              <rect x={-r.width / 2} y={-r.depth / 2} width={r.width} height={r.depth} fill={textureBase(r.surface)} strokeWidth={stroke * 2} />
            ) : (
              <ellipse rx={r.width / 2} ry={r.depth / 2} fill={textureBase(r.surface)} strokeWidth={stroke * 2} />
            )}
          </g>
        );
      })}
      {shade && <image className={styles.planShade} href={shade} x={-hw} y={-hd} width={2 * hw} height={2 * hd} preserveAspectRatio="none" />}
      {grid.map((v) => (
        <g key={v} className={styles.planGrid} strokeWidth={stroke}>
          {Math.abs(v) <= hw && <line x1={v} x2={v} y1={-hd} y2={hd} />}
          {Math.abs(v) <= hd && <line x1={-hw} x2={hw} y1={v} y2={v} />}
        </g>
      ))}
      <rect className={styles.planBoundary} x={-hw} y={-hd} width={2 * hw} height={2 * hd} strokeWidth={stroke * 3} />

      {(layout.hills ?? []).map((h, i) => {
        const key = keyOf({ kind: 'hill', index: i });
        const r = Math.max(0.6, view.span / 80);
        return (
          <g key={key} className={styles.planHill} data-selected={selection.has(key) || undefined} data-invalid={invalid.has(key) || undefined} data-hollow={h.height < 0 || undefined}>
            <title>{`${h.height < 0 ? 'Hollow' : 'Hill'} ${i + 1}: ${Math.abs(h.height)} m ${h.height < 0 ? 'deep' : 'high'}`}</title>
            <g transform={`translate(${-h.x} ${-h.z}) rotate(${-h.rotation})`}>
              <ellipse rx={h.width / 2} ry={h.depth / 2} strokeWidth={stroke * 2} />
              {h.plateau > 0 && <ellipse rx={(h.width / 2) * h.plateau} ry={(h.depth / 2) * h.plateau} strokeWidth={stroke} />}
            </g>
            <circle cx={-h.x} cy={-h.z} r={r} strokeWidth={stroke * 2} onPointerDown={(e) => startItem({ kind: 'hill', index: i }, e)} />
            <text x={-h.x} y={-h.z + r * 0.4} fontSize={r * 1.2}>
              {h.height < 0 ? '▼' : '▲'}
            </text>
          </g>
        );
      })}

      {checks?.unreachable.map((c, i) => (
        <rect key={`u${i}`} className={styles.planUnreachable} x={-c.x - c.size / 2} y={-c.z - c.size / 2} width={c.size} height={c.size} />
      ))}

      {layout.props.map((p, i) => {
        const key = keyOf({ kind: 'prop', index: i });
        const selected = selection.has(key);
        const low = p.height < lowCoverHeight;
        const fill = low ? look.map.low : look.map.prop;
        return (
          <g
            key={key}
            className={styles.planProp}
            data-selected={selected || undefined}
            data-invalid={invalid.has(key) || undefined}
            data-low={low || undefined}
            transform={`translate(${-p.x} ${-p.z}) rotate(${-p.rotation})`}
            onPointerDown={(e) => startItem({ kind: 'prop', index: i }, e)}
          >
            <title>{`${PROPS[p.kind].name} ${i + 1}: ${p.height} m tall${low ? ', low cover' : ''}`}</title>
            {PROPS[p.kind].shape === 'circle' ? (
              <circle r={p.width / 2} fill={fill} strokeWidth={stroke * 2} />
            ) : (
              <rect x={-p.width / 2} y={-p.depth / 2} width={p.width} height={p.depth} fill={fill} strokeWidth={stroke * 2} />
            )}
            {/* A tick on the prop's front (local +z) shows which way it faces. */}
            {PROPS[p.kind].shape === 'box' && <line x1={0} y1={-p.depth / 2} x2={0} y2={-p.depth / 2 + Math.min(0.5, p.depth / 3)} strokeWidth={stroke * 2} className={styles.planFront} />}
          </g>
        );
      })}

      {checks?.exposedPairs.map(([a, b]) => {
        const p = layout.spawnPoints[a]!;
        const q = layout.spawnPoints[b]!;
        return <line key={`x${a}-${b}`} className={styles.planExposed} x1={-p.x} y1={-p.z} x2={-q.x} y2={-q.z} strokeWidth={stroke * 2} />;
      })}

      {layout.spawnPoints.map((p, i) => {
        const key = keyOf({ kind: 'spawn', index: i });
        const r = Math.max(SPAWN_RADIUS, view.span / 70);
        return (
          <g
            key={key}
            className={styles.planSpawn}
            data-selected={selection.has(key) || undefined}
            data-invalid={invalid.has(key) || undefined}
            onPointerDown={(e) => startItem({ kind: 'spawn', index: i }, e)}
          >
            <title>{`Spawn point ${i + 1}`}</title>
            <circle cx={-p.x} cy={-p.z} r={r} strokeWidth={stroke * 2} />
            <text x={-p.x} y={-p.z + r * 0.38} fontSize={r * 1.1}>
              {i + 1}
            </text>
          </g>
        );
      })}

      {handleRef && <Handles layout={layout} refItem={handleRef} span={view.span} onStart={startHandle} />}

      {gesture?.kind === 'box' && (
        <rect
          className={styles.planMarquee}
          x={-Math.max(gesture.startX, gesture.x)}
          y={-Math.max(gesture.startZ, gesture.z)}
          width={Math.abs(gesture.x - gesture.startX)}
          height={Math.abs(gesture.z - gesture.startZ)}
          strokeWidth={stroke * 2}
        />
      )}
      {tool && hover && <Ghost tool={tool} x={snapped(hover.x)} z={snapped(hover.z)} stroke={stroke} />}
    </svg>
  );
}

const fitAspect = (hw: number, hd: number) => Math.max(0.6, Math.min(2.2, (hw + PAD) / (hd + PAD)));

function toFloor(el: SVGSVGElement, clientX: number, clientY: number): { x: number; z: number } {
  const point = el.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(el.getScreenCTM()!.inverse());
  return { x: -local.x, z: -local.y };
}

function itemAt(layout: WorldLayoutDto, ref: ItemRef): { x: number; z: number; rotation: number; width: number; depth: number; kind?: PropKind } {
  if (ref.kind === 'prop') return layout.props[ref.index]!;
  if (ref.kind === 'region') return layout.regions[ref.index]!;
  if (ref.kind === 'hill') return layout.hills![ref.index]!;
  return { ...layout.spawnPoints[ref.index]!, rotation: 0, width: 0, depth: 0 };
}

/**
 * Hill shading for the plan as an image URL (null on flat ground): pixel (i, j) covers
 * x = −halfWidth + i·step, z = −halfDepth + j·step; the plan's flipped view box turns it the right way.
 */
function hillShadeUrl(layout: WorldLayoutDto): string | null {
  const field = buildHeightField(layout);
  if (!field) return null;
  const step = Math.max(0.5, (Math.max(layout.halfWidth, layout.halfDepth) * 2) / 300);
  const cols = Math.round((layout.halfWidth * 2) / step);
  const rows = Math.round((layout.halfDepth * 2) / step);
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(cols, rows);
  const sx = (layout.halfWidth * 2) / cols;
  const sz = (layout.halfDepth * 2) / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      // The SVG maps image x to −world x and image y to −world z.
      const x = layout.halfWidth - (i + 0.5) * sx;
      const z = layout.halfDepth - (j + 0.5) * sz;
      const gx = (heightAt(field, x + sx, z) - heightAt(field, x - sx, z)) / (2 * sx);
      const gz = (heightAt(field, x, z + sz) - heightAt(field, x, z - sz)) / (2 * sz);
      const lit = (-gx * 0.5 + Math.SQRT1_2 - gz * 0.5) / Math.hypot(gx, 1, gz) - Math.SQRT1_2;
      const k = (j * cols + i) * 4;
      image.data[k] = image.data[k + 1] = image.data[k + 2] = lit < 0 ? 0 : 255;
      image.data[k + 3] = Math.min(160, Math.abs(lit) * (lit < 0 ? 420 : 260));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/** Turn and resize handles for one selected prop or region. */
function Handles({ layout, refItem, span, onStart }: { layout: WorldLayoutDto; refItem: ItemRef; span: number; onStart: (kind: 'rotate' | 'resize', ref: ItemRef, e: ReactPointerEvent) => void }) {
  const item = itemAt(layout, refItem);
  const isRound = refItem.kind === 'prop' && item.kind !== undefined && PROPS[item.kind].shape === 'circle';
  const size = Math.max(0.35, span / 90);
  const a = (item.rotation * Math.PI) / 180;
  // World position of a local point (lx, lz) on the item.
  const at = (lx: number, lz: number) => ({ x: item.x + lx * Math.cos(a) + lz * Math.sin(a), z: item.z - lx * Math.sin(a) + lz * Math.cos(a) });
  const rotate = at(0, item.depth / 2 + size * 3);
  const resize = isRound ? at(item.width / 2 / Math.SQRT2, item.width / 2 / Math.SQRT2) : at(item.width / 2, item.depth / 2);
  const front = at(0, item.depth / 2);
  return (
    <g className={styles.planHandles}>
      {!isRound && <line x1={-front.x} y1={-front.z} x2={-rotate.x} y2={-rotate.z} strokeWidth={size / 5} />}
      <circle
        cx={-rotate.x}
        cy={-rotate.z}
        r={size}
        className={styles.planHandle}
        data-handle="rotate"
        onPointerDown={(e) => onStart('rotate', refItem, e)}
      >
        <title>Drag to turn (Shift: 1° steps)</title>
      </circle>
      <rect
        x={-resize.x - size}
        y={-resize.z - size}
        width={size * 2}
        height={size * 2}
        className={styles.planHandle}
        data-handle="resize"
        onPointerDown={(e) => onStart('resize', refItem, e)}
      >
        <title>Drag to resize</title>
      </rect>
    </g>
  );
}

/** A preview of what a click would place. */
function Ghost({ tool, x, z, stroke }: { tool: Tool; x: number; z: number; stroke: number }) {
  if (tool.kind === 'spawn') return <circle className={styles.planGhost} cx={-x} cy={-z} r={SPAWN_RADIUS} strokeWidth={stroke * 2} />;
  if (tool.kind === 'hill') return <ellipse className={styles.planGhost} cx={-x} cy={-z} rx={8} ry={8} strokeWidth={stroke * 2} />;
  if (tool.kind === 'region') {
    const size = 6;
    return tool.shape === 'rect' ? (
      <rect className={styles.planGhost} x={-x - size / 2} y={-z - size / 2} width={size} height={size} strokeWidth={stroke * 2} />
    ) : (
      <ellipse className={styles.planGhost} cx={-x} cy={-z} rx={size / 2} ry={size / 2} strokeWidth={stroke * 2} />
    );
  }
  const { width, depth } = PROPS[tool.prop].size;
  return PROPS[tool.prop].shape === 'circle' ? (
    <circle className={styles.planGhost} cx={-x} cy={-z} r={width / 2} strokeWidth={stroke * 2} />
  ) : (
    <rect className={styles.planGhost} x={-x - width / 2} y={-z - depth / 2} width={width} height={depth} strokeWidth={stroke * 2} />
  );
}
