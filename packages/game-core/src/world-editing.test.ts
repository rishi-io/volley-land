import { describe, expect, it } from 'vitest';
import { prop } from './layout-tools.js';
import type { WorldLayout } from './world.js';
import { checkWorld, playRulesOf } from './world-checks.js';
import { deleteItems, duplicateItems, itemsIn, mirrorItems, moveItems, reorderRegion, rotateItems, updateItem } from './world-editing.js';

const layout: WorldLayout = {
  halfWidth: 20,
  halfDepth: 20,
  theme: 'park',
  floor: 'grass',
  scatter: 0.5,
  regions: [
    { surface: 'cobbles', shape: 'rect', x: 0, z: 0, width: 4, depth: 40, rotation: 0 },
    { surface: 'dirt', shape: 'ellipse', x: 5, z: 5, width: 6, depth: 4, rotation: 0 },
  ],
  props: [prop('wall', 5, 5, { width: 6, depth: 0.6 }), prop('tree', -8, 8)],
  spawnPoints: [
    { x: -15, z: -15 },
    { x: 15, z: 15 },
  ],
};

describe('world builder editing', () => {
  it('moves the selection together, snapped, and keeps props on the floor', () => {
    const moved = moveItems(layout, [{ kind: 'prop', index: 0 }, { kind: 'spawn', index: 0 }], 1.26, -0.74, 0.5);
    expect(moved.props[0]).toMatchObject({ x: 6.5, z: 4.5 });
    expect(moved.spawnPoints[0]).toEqual({ x: -13.5, z: -15.5 });
    expect(layout.props[0]!.x).toBe(5); // the original is untouched
    const pushed = moveItems(layout, [{ kind: 'prop', index: 0 }], 100, 0, 0.5);
    expect(pushed.props[0]!.x).toBe(17); // 20 minus half the wall's 6 m width
  });

  it('turns props and regions about their own centres and leaves spawn points alone', () => {
    const turned = rotateItems(layout, [{ kind: 'prop', index: 0 }, { kind: 'region', index: 1 }, { kind: 'spawn', index: 0 }], -15);
    expect(turned.props[0]!.rotation).toBe(345);
    expect(turned.regions[1]!.rotation).toBe(345);
    expect(turned.spawnPoints).toEqual(layout.spawnPoints);
  });

  it('duplicates and mirrors, returning the copies to select', () => {
    const { layout: dup, added } = duplicateItems(layout, [{ kind: 'prop', index: 1 }]);
    expect(added).toEqual([{ kind: 'prop', index: 2 }]);
    expect(dup.props[2]).toMatchObject({ kind: 'tree', x: -7, z: 7 });

    const { layout: mirrored, added: copies } = mirrorItems(layout, [{ kind: 'prop', index: 0 }], 'quad');
    expect(copies).toHaveLength(3);
    expect(mirrored.props.slice(2).map((p) => [p.x, p.z])).toEqual([
      [-5, 5],
      [5, -5],
      [-5, -5],
    ]);
    // The path down the middle (x = 0) mirrors onto itself left–right: no copy.
    expect(mirrorItems(layout, [{ kind: 'region', index: 0 }], 'mirror-x').added).toEqual([]);
  });

  it('deletes items but never below the minimum number of spawn points', () => {
    const fewer = deleteItems(layout, [{ kind: 'prop', index: 0 }, { kind: 'spawn', index: 1 }]);
    expect(fewer.props.map((p) => p.kind)).toEqual(['tree']);
    expect(fewer.spawnPoints).toHaveLength(2);
  });

  it('keeps round props as deep as they are wide, and reorders patches', () => {
    const wider = updateItem(layout, { kind: 'prop', index: 1 }, { width: 4 });
    expect(wider.props[1]).toMatchObject({ width: 4, depth: 4 });
    const { layout: reordered, index } = reorderRegion(layout, 0, 1);
    expect(index).toBe(1);
    expect(reordered.regions.map((r) => r.surface)).toEqual(['dirt', 'cobbles']);
  });

  it('box-selects props and spawn points by their centres', () => {
    expect(itemsIn(layout, 0, 0, 20, 20)).toEqual([
      { kind: 'prop', index: 0 },
      { kind: 'spawn', index: 1 },
    ]);
  });
});

describe('play checks', () => {
  const rules = playRulesOf({ playerRadius: 0.5, maxSlopeDeg: 40, projectileHeight: 1.2, projectileRadius: 0.25, projectileSpeed: 18, projectileLifetimeMs: 1500 }, 4);

  it('flags spawn points walled off and floor nobody can reach', () => {
    const walled: WorldLayout = { ...layout, props: [prop('wall', 0, 0, { width: 40, depth: 1, rotation: 90 })] };
    const result = checkWorld(walled, rules);
    expect(result.checks.find((c) => c.level === 'problem')?.text).toMatch(/Spawn point 2 is walled off/);
    expect(result.unreachable.length).toBeGreaterThan(100);
  });

  it('flags spawn points that can throw at each other, unless cover is between them', () => {
    const close: WorldLayout = { ...layout, props: [], spawnPoints: [{ x: -5, z: 0 }, { x: 5, z: 0 }] };
    expect(checkWorld(close, rules).exposedPairs).toEqual([[0, 1]]);
    const covered = { ...close, props: [prop('wall', 0, 0, { width: 4, depth: 0.5, rotation: 90 })] };
    expect(checkWorld(covered, rules).exposedPairs).toEqual([]);
    const low = { ...close, props: [prop('hedge', 0, 0, { width: 4, rotation: 90 })] };
    expect(checkWorld(low, rules).exposedPairs).toEqual([[0, 1]]); // throws fly over a hedge
  });

  it('says when a floor is roomy for the player count', () => {
    const huge: WorldLayout = { ...layout, halfWidth: 100, halfDepth: 100 };
    expect(checkWorld(huge, rules).checks.some((c) => c.text.startsWith('Roomy for 4 players'))).toBe(true);
  });
});
