import { WorldLayoutSchema } from '@volleyland/contracts';
import { type WorldLayout, blankLayout, generateLayout } from '@volleyland/game-core';
import { describe, expect, it } from 'vitest';
import { OperationError } from '../operations/operation.js';
import { type WorldEdit, WorldEditSchema, applyWorldEdits } from './world-edits.js';

const start = (): WorldLayout => blankLayout('park');
const edits = (raw: unknown[]): WorldEdit[] => raw.map((e) => WorldEditSchema.parse(e));
const apply = (raw: unknown[], layout = start()) => applyWorldEdits(layout, edits(raw));

describe('world edits', () => {
  it('raises hills, shapes the rolling ground, and edits hills like other items', () => {
    const layout = apply([
      { op: 'add_hill', x: 6, z: 6, height: 3 },
      { op: 'add_hill', x: -10, z: 0, width: 20, depth: 6, rotation: 45, height: -2, plateau: 0.4 },
      { op: 'set_terrain', relief: 2.5 },
      { op: 'set_terrain', seed: 9 },
      { op: 'mirror', items: [{ kind: 'hill', index: 0 }], symmetry: 'mirror-x' },
      { op: 'update', item: { kind: 'hill', index: 2 }, set: { plateau: 0.6 } },
      { op: 'move', items: [{ kind: 'hill', index: 1 }], dx: 2, dz: 0 },
    ]);
    expect(layout.hills).toEqual([
      { x: 6, z: 6, width: 16, depth: 16, rotation: 0, height: 3, plateau: 0 },
      { x: -8, z: 0, width: 20, depth: 6, rotation: 45, height: -2, plateau: 0.4 },
      { x: -6, z: 6, width: 16, depth: 16, rotation: 0, height: 3, plateau: 0.6 },
    ]);
    expect(layout.terrain).toEqual({ relief: 2.5, scale: 30, seed: 9, symmetry: 'quad' });
    expect(WorldLayoutSchema.safeParse(layout).success).toBe(true);
    expect(apply([{ op: 'clear', what: 'hills' }], layout).hills).toEqual([]);
    expect(() => apply([{ op: 'update', item: { kind: 'hill', index: 0 }, set: { kind: 'tree' } }], layout)).toThrow(OperationError);
    expect(() => apply([{ op: 'remove', items: [{ kind: 'hill', index: 0 }] }])).toThrow(/there is no hill 0/);
  });

  it('generates hilly layouts when asked for relief', () => {
    const layout = apply([{ op: 'generate', theme: 'park', width: 80, depth: 80, relief: 0.8 }]);
    expect(layout.terrain?.relief).toBeGreaterThan(0);
    expect(layout.hills?.length).toBeGreaterThan(0);
    expect(WorldLayoutSchema.safeParse(layout).success).toBe(true);
  });

  it('adds props (alone and in a ring), floor patches and spawn points', () => {
    const layout = apply([
      { op: 'add_prop', kind: 'tree', x: 10, z: -10 },
      { op: 'add_prop', kind: 'wall', x: 0, z: 12, rotation: 90, width: 8 },
      { op: 'add_ring', kind: 'hedge', count: 6, radius: 8, x: 5 },
      { op: 'add_region', surface: 'cobbles', shape: 'rect', x: 0, z: 0, width: 4, depth: 20 },
      { op: 'add_spawn', x: 0, z: -20 },
    ]);
    expect(layout.props).toHaveLength(8);
    expect(layout.props[0]).toMatchObject({ kind: 'tree', x: 10, z: -10, width: 2.6, depth: 2.6 });
    expect(layout.props[1]).toMatchObject({ kind: 'wall', width: 8, rotation: 90 });
    expect(Math.hypot(layout.props[2]!.x - 5, layout.props[2]!.z)).toBeCloseTo(8, 1);
    expect(layout.regions.at(-1)).toMatchObject({ surface: 'cobbles', rotation: 0 });
    expect(layout.spawnPoints).toHaveLength(5);
    expect(WorldLayoutSchema.safeParse(layout).success).toBe(true);
  });

  it("runs the builder's move, rotate, duplicate, mirror, update and remove in order", () => {
    const layout = apply([
      { op: 'add_prop', kind: 'crate', x: 4, z: 4 },
      { op: 'move', items: [{ kind: 'prop', index: 0 }], dx: 1.26, dz: 0, snap: 0.5 },
      { op: 'rotate', items: [{ kind: 'prop', index: 0 }], degrees: -15 },
      { op: 'mirror', items: [{ kind: 'prop', index: 0 }], symmetry: 'quad' },
      { op: 'update', item: { kind: 'prop', index: 3 }, set: { height: 2 } },
      { op: 'duplicate', items: [{ kind: 'prop', index: 0 }], dx: 0, dz: 3 },
      { op: 'remove', items: [{ kind: 'prop', index: 1 }] },
    ]);
    expect(layout.props.map((p) => [p.x, p.z])).toEqual([
      [5.5, 4],
      [5.5, -4],
      [-5.5, -4],
      [5.5, 7],
    ]);
    expect(layout.props[0]!.rotation).toBe(345);
    expect(layout.props[2]!.height).toBe(2);
  });

  it('changes the floor, clears lists, reorders patches and generates', () => {
    const generated = apply([{ op: 'generate', theme: 'snow', width: 80, depth: 60, seed: 7 }]);
    expect(generated).toEqual(generateLayout({ theme: 'snow', width: 80, depth: 60, density: 0.55, symmetry: 'quad', spawns: 4, seed: 7 }));
    const floor = apply([{ op: 'set_floor', width: 40, theme: 'beach', floor: 'sand', scatter: 0.2 }, { op: 'clear', what: 'regions' }], generated);
    expect(floor).toMatchObject({ halfWidth: 20, halfDepth: 30, theme: 'beach', floor: 'sand', scatter: 0.2, regions: [] });
    const two = apply([
      { op: 'clear', what: 'regions' },
      { op: 'add_region', surface: 'dirt', shape: 'ellipse', x: 0, z: 0, width: 5, depth: 5 },
      { op: 'add_region', surface: 'cobbles', shape: 'rect', x: 0, z: 0, width: 4, depth: 20 },
      { op: 'reorder_region', index: 0, direction: 1 },
    ]);
    expect(two.regions.map((r) => r.surface)).toEqual(['cobbles', 'dirt']);
  });

  it('rejects the whole batch for a missing item, a field the item lacks, or a full list, naming the edit', () => {
    const fail = (raw: unknown[]) => {
      try {
        apply(raw);
      } catch (error) {
        expect(error).toBeInstanceOf(OperationError);
        return (error as OperationError).message;
      }
      throw new Error('expected the edits to be rejected');
    };
    expect(fail([{ op: 'add_prop', kind: 'tree', x: 0, z: 0 }, { op: 'remove', items: [{ kind: 'prop', index: 5 }] }])).toBe(
      'Edit 2 (remove): there is no prop 5 (the layout has 1 props)',
    );
    expect(fail([{ op: 'update', item: { kind: 'spawn', index: 0 }, set: { height: 3 } }])).toBe('Edit 1 (update): a spawn has no height');
    expect(fail([{ op: 'add_ring', kind: 'tree', count: 64, radius: 20 }, ...Array.from({ length: 6 }, () => ({ op: 'add_ring', kind: 'rock', count: 64, radius: 20 }))])).toMatch(
      /Edit 7 \(add_ring\): a world holds at most 400 props/,
    );
  });
});
