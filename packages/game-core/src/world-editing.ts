import { applySymmetry, normalizeDegrees, type Symmetry } from './layout-tools.js';
import type { TerrainHill } from './terrain.js';
import { PROPS, WORLD_LIMITS, type WorldLayout, propExtent } from './world.js';

/*
 * Pure editing operations on a world layout, shared by the admin world builder and the server's
 * world-editing operations (so an MCP client edits exactly as the builder does). Each takes a
 * layout and returns a new one; items are addressed by list and index.
 */

export type LayoutItemKind = 'prop' | 'region' | 'spawn' | 'hill';
export interface LayoutItemRef {
  kind: LayoutItemKind;
  index: number;
}

const LISTS = { prop: 'props', region: 'regions', spawn: 'spawnPoints', hill: 'hills' } as const;

/** The list an item kind lives in (a layout without hills has an empty hill list). */
const listOf = (layout: WorldLayout, kind: LayoutItemKind): readonly { x: number; z: number }[] => layout[LISTS[kind]] ?? [];

/** A new hill: a smooth 16 m mound, `height` tall (negative for a hollow). */
export function newHill(x = 0, z = 0, height = 3): TerrainHill {
  return { x, z, width: 16, depth: 16, rotation: 0, height, plateau: 0 };
}

/** A value snapped to a step (0.01 m by default). */
export const snapTo = (v: number, step = 0.01) => Math.round(v / step) * step;
const tidy = (v: number) => Number(v.toFixed(3));

/** Keep a point (or a prop's whole footprint) on the floor. */
function clampOnFloor(layout: WorldLayout, ref: LayoutItemRef, x: number, z: number): { x: number; z: number } {
  let ex = 0;
  let ez = 0;
  if (ref.kind === 'prop') {
    const e = propExtent(layout.props[ref.index]!);
    ex = e.x;
    ez = e.z;
  }
  const lim = (v: number, half: number, extent: number) => Math.max(-(half - extent), Math.min(half - extent, v));
  return { x: tidy(lim(x, layout.halfWidth, Math.min(ex, layout.halfWidth))), z: tidy(lim(z, layout.halfDepth, Math.min(ez, layout.halfDepth))) };
}

export function positionOf(layout: WorldLayout, ref: LayoutItemRef): { x: number; z: number } {
  const item = listOf(layout, ref.kind)[ref.index]!;
  return { x: item.x, z: item.z };
}

/** Move items by (dx, dz) from where they were in `from` (the layout when the drag began). Snaps each item's position. */
export function moveItems(from: WorldLayout, refs: readonly LayoutItemRef[], dx: number, dz: number, snap: number): WorldLayout {
  const next = cloneLists(from);
  for (const ref of refs) {
    const list = next[LISTS[ref.kind]] as { x: number; z: number }[] | undefined;
    const item = list?.[ref.index];
    if (!list || !item) continue;
    const s = snap > 0 ? snap : 0.01;
    const target = clampOnFloor(from, ref, snapTo(item.x + dx, s), snapTo(item.z + dz, s));
    list[ref.index] = { ...item, ...target };
  }
  return next;
}

/** Turn props, regions and hills about their own centres by `degrees`. Spawn points have no turn. */
export function rotateItems(layout: WorldLayout, refs: readonly LayoutItemRef[], degrees: number): WorldLayout {
  const next = cloneLists(layout);
  for (const ref of refs) {
    if (ref.kind === 'spawn') continue;
    const list = next[LISTS[ref.kind]] as { rotation: number }[] | undefined;
    const item = list?.[ref.index];
    if (list && item) list[ref.index] = { ...item, rotation: normalizeDegrees(item.rotation + degrees) };
  }
  return next;
}

/** Remove items; returns the layout and nothing selected. Never drops spawn points below the minimum. */
export function deleteItems(layout: WorldLayout, refs: readonly LayoutItemRef[]): WorldLayout {
  const drop = (kind: LayoutItemKind) => new Set(refs.filter((r) => r.kind === kind).map((r) => r.index));
  const props = drop('prop');
  const regions = drop('region');
  const hills = drop('hill');
  let spawns = drop('spawn');
  if (layout.spawnPoints.length - spawns.size < WORLD_LIMITS.minSpawnPoints) spawns = new Set();
  return {
    ...layout,
    props: layout.props.filter((_, i) => !props.has(i)),
    regions: layout.regions.filter((_, i) => !regions.has(i)),
    spawnPoints: layout.spawnPoints.filter((_, i) => !spawns.has(i)),
    ...(layout.hills && { hills: layout.hills.filter((_, i) => !hills.has(i)) }),
  };
}

/** Copy items, offset by (dx, dz). Returns the new layout and the copies, to select them. */
export function duplicateItems(layout: WorldLayout, refs: readonly LayoutItemRef[], dx = 1, dz = -1): { layout: WorldLayout; added: LayoutItemRef[] } {
  const next = cloneLists(layout);
  const added: LayoutItemRef[] = [];
  for (const ref of refs) {
    const list = next[LISTS[ref.kind]] as { x: number; z: number }[] | undefined;
    const item = listOf(layout, ref.kind)[ref.index];
    if (!list || !item || list.length >= limitOf(ref.kind)) continue;
    const at = clampOnFloor(layout, ref, item.x + dx, item.z + dz);
    list.push({ ...item, ...at });
    added.push({ kind: ref.kind, index: list.length - 1 });
  }
  return { layout: next, added };
}

/**
 * Add mirror-image copies of items (left/right, front/back or four-way), for fair worlds. Items
 * on a mirror line are not copied onto themselves. Returns the copies, to select them.
 */
export function mirrorItems(layout: WorldLayout, refs: readonly LayoutItemRef[], symmetry: Exclude<Symmetry, 'none'>): { layout: WorldLayout; added: LayoutItemRef[] } {
  const next = cloneLists(layout);
  const added: LayoutItemRef[] = [];
  for (const ref of refs) {
    const source = (listOf(layout, ref.kind) as { x: number; z: number; rotation?: number }[])[ref.index];
    const list = next[LISTS[ref.kind]] as unknown[] | undefined;
    if (!source || !list) continue;
    const copies = applySymmetry([{ ...source, rotation: source.rotation ?? 0 }], symmetry).slice(1);
    for (const copy of copies) {
      if (list.length >= limitOf(ref.kind)) break;
      const item = ref.kind === 'spawn' ? { x: copy.x, z: copy.z } : { ...copy, x: tidy(copy.x), z: tidy(copy.z) };
      list.push(item);
      added.push({ kind: ref.kind, index: list.length - 1 });
    }
  }
  return { layout: next, added };
}

/** Move a region one step up or down the paint order (later regions are drawn on top). */
export function reorderRegion(layout: WorldLayout, index: number, direction: 1 | -1): { layout: WorldLayout; index: number } {
  const target = index + direction;
  if (target < 0 || target >= layout.regions.length) return { layout, index };
  const regions = [...layout.regions];
  [regions[index], regions[target]] = [regions[target]!, regions[index]!];
  return { layout: { ...layout, regions }, index: target };
}

/** Change one item's fields. */
export function updateItem<K extends LayoutItemKind>(layout: WorldLayout, ref: LayoutItemRef & { kind: K }, patch: Record<string, unknown>): WorldLayout {
  const next = cloneLists(layout);
  const list = next[LISTS[ref.kind]] as unknown as Record<string, unknown>[] | undefined;
  const item = list?.[ref.index];
  if (!list || !item) return layout;
  const updated = { ...item, ...patch };
  // Round props stay as deep as they are wide.
  if (ref.kind === 'prop' && PROPS[updated.kind as keyof typeof PROPS].shape === 'circle') updated.depth = updated.width;
  list[ref.index] = updated;
  return next;
}

/** Props and spawn points whose centres fall inside a floor rectangle (box selection; hills are picked by clicking). */
export function itemsIn(layout: WorldLayout, minX: number, minZ: number, maxX: number, maxZ: number): LayoutItemRef[] {
  const inside = (p: { x: number; z: number }) => p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ;
  return [
    ...layout.props.flatMap((p, index) => (inside(p) ? [{ kind: 'prop' as const, index }] : [])),
    ...layout.spawnPoints.flatMap((p, index) => (inside(p) ? [{ kind: 'spawn' as const, index }] : [])),
  ];
}

const limitOf = (kind: LayoutItemKind) =>
  ({ prop: WORLD_LIMITS.maxProps, region: WORLD_LIMITS.maxRegions, spawn: WORLD_LIMITS.maxSpawnPoints, hill: WORLD_LIMITS.maxHills })[kind];

const cloneLists = (layout: WorldLayout): WorldLayout => ({
  ...layout,
  props: [...layout.props],
  regions: [...layout.regions],
  spawnPoints: [...layout.spawnPoints],
  ...(layout.hills && { hills: [...layout.hills] }),
});
